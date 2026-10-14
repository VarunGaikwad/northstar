import { z } from "zod";

export const createFavlinkSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be at most 200 characters"),
  url: z.string().trim().url("Invalid URL").max(2048, "URL must be at most 2048 characters"),
  folderId: z.string().cuid("Invalid folder id").optional(),
});

export const updateFavlinkSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(200, "Title must be at most 200 characters").optional(),
    url: z.string().trim().url("Invalid URL").max(2048, "URL must be at most 2048 characters").optional(),
    folderId: z
      .union([z.string().cuid("Invalid folder id"), z.null()])
      .optional(),
  })
  .refine((data) => data.title !== undefined || data.url !== undefined || data.folderId !== undefined, {
    message: "At least one field must be provided",
  });

export type CreateFavlinkInput = z.infer<typeof createFavlinkSchema>;
export type UpdateFavlinkInput = z.infer<typeof updateFavlinkSchema>;
