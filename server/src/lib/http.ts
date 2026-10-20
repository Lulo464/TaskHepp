import { z } from 'zod';

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** Validates input; failures become a 400 listing the offending fields. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, result.error.issues.map(i => (i.path.length ? `${i.path.join('.')}: ` : '') + i.message).join('; '));
  }
  return result.data;
}

export const idParam = z.object({ id: z.coerce.number().int().positive() });

export const notFound = (what = 'Nicht gefunden') => new HttpError(404, what);
export const badRequest = (msg: string) => new HttpError(400, msg);
