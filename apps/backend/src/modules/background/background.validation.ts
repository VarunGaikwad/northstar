import { z } from "zod";

export const backgroundQuerySchema = z.object({
  query: z.string().trim().min(1).optional(),
});

export type BackgroundQuery = z.infer<typeof backgroundQuerySchema>;
