// See LICENSE file in the project root for license information.

import * as z from "zod";

export const whoamiSchema = z.object({
  id: z.string(),
  role: z.string(),
  name: z.string().optional(),
  email: z.string().optional(),
  permissions: z.array(z.string()).optional(),
});

export type Whoami = z.infer<typeof whoamiSchema>;
