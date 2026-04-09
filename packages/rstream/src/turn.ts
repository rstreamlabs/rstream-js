// See LICENSE file in the project root for license information.

import * as z from "zod";

export const turnCredentialsSchema = z.object({
  username: z.string(),
  credential: z.string(),
  urls: z.array(z.string()),
  ttl: z.number().int().nonnegative(),
});

export type TURNCredentials = z.infer<typeof turnCredentialsSchema>;
