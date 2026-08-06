import { prisma } from "../../db/prisma";
import { ApiError } from "../../utils/ApiError";
import type { CreateFavlinkInput, UpdateFavlinkInput } from "./favlinks.validation";
import type { FavLinkResponse } from "./favlinks.types";

const favlinkSelect = {
  id: true,
  title: true,
  url: true,
  folderId: true,
  createdAt: true,
  updatedAt: true,
} as const;

async function getOwnedFavlink(userId: string, favlinkId: string): Promise<FavLinkResponse> {
  const favlink = await prisma.favLink.findFirst({
    where: { id: favlinkId, userId },
    select: favlinkSelect,
  });
  if (!favlink) {
    throw new ApiError("FavLink not found", 404);
  }
  return favlink;
}

async function assertOwnedFolder(userId: string, folderId: string): Promise<void> {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, userId },
    select: { id: true },
  });
  if (!folder) {
    throw new ApiError("Folder not found", 404);
  }
}

export async function create(userId: string, input: CreateFavlinkInput): Promise<FavLinkResponse> {
  if (input.folderId) {
    await assertOwnedFolder(userId, input.folderId);
  }

  return prisma.favLink.create({
    data: {
      userId,
      title: input.title.trim(),
      url: input.url.trim(),
      folderId: input.folderId ?? null,
    },
    select: favlinkSelect,
  });
}

export async function list(userId: string, folderId: string | null): Promise<FavLinkResponse[]> {
  if (folderId) {
    await assertOwnedFolder(userId, folderId);
  }

  return prisma.favLink.findMany({
    where: {
      userId,
      ...(typeof folderId === "string" ? { folderId } : {}),
    },
    select: favlinkSelect,
    orderBy: { createdAt: "desc" },
  });
}

export async function getById(userId: string, favlinkId: string): Promise<FavLinkResponse> {
  return getOwnedFavlink(userId, favlinkId);
}

export async function update(
  userId: string,
  favlinkId: string,
  input: UpdateFavlinkInput,
): Promise<FavLinkResponse> {
  await getOwnedFavlink(userId, favlinkId);

  if (input.folderId) {
    await assertOwnedFolder(userId, input.folderId);
  }

  return prisma.favLink.update({
    where: { id: favlinkId },
    data: {
      ...(input.title !== undefined ? { title: input.title.trim() } : {}),
      ...(input.url !== undefined ? { url: input.url.trim() } : {}),
      ...(input.folderId !== undefined ? { folderId: input.folderId } : {}),
    },
    select: favlinkSelect,
  });
}

export async function remove(userId: string, favlinkId: string): Promise<void> {
  await getOwnedFavlink(userId, favlinkId);
  await prisma.favLink.delete({ where: { id: favlinkId } });
}
