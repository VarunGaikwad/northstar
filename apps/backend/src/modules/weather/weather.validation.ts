import { z } from "zod";

export const weatherQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(
    (data) => {
      if ((data.lat === undefined) !== (data.lon === undefined)) {
        return false;
      }
      return true;
    },
    { message: "Both lat and lon must be provided together" }
  );

export type WeatherQuery = z.infer<typeof weatherQuerySchema>;
