import { z } from "zod";

export const createFolderSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name must be at most 100 characters"),
  parentId: z.string().cuid("Invalid parent folder id").optional(),
});

export const updateFolderSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100, "Name must be at most 100 characters").optional(),
    parentId: z
      .union([z.string().cuid("Invalid parent folder id"), z.null()])
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.parentId !== undefined, {
    message: "At least one field must be provided",
  });

export type CreateFolderInput = z.infer<typeof createFolderSchema>;
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;
