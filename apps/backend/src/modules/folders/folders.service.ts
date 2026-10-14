import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import type { CreateFolderInput, UpdateFolderInput } from "./folders.validation";
import type { FolderResponse } from "./folders.types";

const folderSelect = {
  id: true,
  name: true,
  parentId: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function getOwnedFolder(userId: string, folderId: string): Promise<FolderResponse> {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
    select: folderSelect,
  });
  if (!folder) {
    throw new ApiError("Folder not found", 404);
  }
  return folder;
}

async function assertOwnedFolder(userId: string, folderId: string): Promise<void> {
  await getOwnedFolder(userId, folderId);
}

async function isDescendant(candidateParentId: string, folderId: string): Promise<boolean> {
  let currentId: string | null = candidateParentId;
  const visited = new Set<string>();

  while (currentId) {
    if (currentId === folderId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);

    const parent: { parentId: string | null } | null = await prisma.folder.findUnique({
      where: { id: currentId },
      select: { parentId: true },
    });
    if (!parent) return false;
    currentId = parent.parentId;
  }

  return false;
}

export async function create(userId: string, input: CreateFolderInput): Promise<FolderResponse> {
  if (input.parentId) {
    await assertOwnedFolder(userId, input.parentId);
  }

  return prisma.folder.create({
    data: {
      userId,
      name: input.name.trim(),
      parentId: input.parentId ?? null,
    },
    select: folderSelect,
  });
}

export async function list(userId: string): Promise<FolderResponse[]> {
  return prisma.folder.findMany({
    where: { userId },
    select: folderSelect,
    orderBy: { createdAt: "asc" },
  });
}

export async function getById(userId: string, folderId: string): Promise<FolderResponse> {
  return getOwnedFolder(userId, folderId);
}

export async function update(
  userId: string,
  folderId: string,
  input: UpdateFolderInput,
): Promise<FolderResponse> {
  await getOwnedFolder(userId, folderId);

  if (input.parentId !== undefined && input.parentId !== null) {
    await assertOwnedFolder(userId, input.parentId);
    if (input.parentId === folderId) {
      throw new ApiError("A folder cannot be its own parent", 400);
    }
    if (await isDescendant(input.parentId, folderId)) {
      throw new ApiError("Cannot move a folder into one of its descendants", 400);
    }
  }

  return prisma.folder.update({
    where: { id: folderId },
    data: {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    },
    select: folderSelect,
  });
}

export async function remove(userId: string, folderId: string): Promise<void> {
  await getOwnedFolder(userId, folderId);
  await prisma.folder.delete({ where: { id: folderId } });
}
