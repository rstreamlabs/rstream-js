// See LICENSE file in the project root for license information.

import * as z from "zod";

export const StringFilter = z.union([
  z.string(),
  z.object({ exact: z.string() }),
  z.object({ oneof: z.array(z.string()) }),
  z.object({ regex: z.string() }),
]);

type TransformProps<T extends z.ZodTypeAny> =
  T extends z.ZodOptional<infer U>
    ? TransformProps<U>
    : T extends z.ZodString
      ? z.ZodOptional<typeof StringFilter>
      : T extends z.ZodRecord<infer K, infer V>
        ? z.ZodOptional<z.ZodRecord<K, TransformProps<V>>>
        : z.ZodOptional<T>;

function transform(field: z.ZodTypeAny): z.ZodTypeAny {
  if (field instanceof z.ZodOptional) {
    return transform(field.unwrap()).optional();
  }
  if (field instanceof z.ZodString) {
    return StringFilter.optional();
  }
  if (field instanceof z.ZodRecord) {
    return z.record(field.keySchema, transform(field.valueSchema)).optional();
  }
  return field.optional();
}

type FilterProps<T extends z.ZodTypeAny> =
  T extends z.ZodOptional<infer U>
    ? FilterProps<U>
    : T extends z.ZodString
      ? z.input<typeof StringFilter>
      : T extends z.ZodRecord<any, infer V>
        ? Record<string, FilterProps<V>>
        : z.input<T>;

type Logical<T> = T | { AND: Logical<T>[] } | { OR: Logical<T>[] };

export type FilterNode<S extends Record<string, z.ZodTypeAny>> = Logical<{
  [K in keyof S]?: FilterProps<S[K]>;
}>;

export function filters<T extends z.ZodObject<Record<string, z.ZodTypeAny>>>(
  base: T,
): z.ZodType<FilterNode<T["shape"]>> {
  type S = T["shape"];
  type SchemaShape = { [K in keyof S]: TransformProps<S[K]> };
  const entries = Object.entries(base.shape).map(([key, field]) => [
    key,
    transform(field),
  ]);
  const shape = Object.fromEntries(entries) satisfies SchemaShape;
  const node: z.ZodType<FilterNode<S>> = z.lazy(() =>
    z.union([
      z.object(shape),
      z.object({ AND: z.array(node) }),
      z.object({ OR: z.array(node) }),
    ]),
  );
  return node;
}

type BuildSelectShape<S extends Record<string, z.ZodType<unknown>>> = {
  [K in keyof S]: z.ZodOptional<z.ZodBoolean>;
};

export function select<
  T extends z.ZodObject<Record<string, z.ZodType<unknown>>>,
>(base: T): z.ZodObject<BuildSelectShape<T["shape"]>> {
  const entries = Object.entries(base.shape).map(([key]) => {
    return [key, z.boolean().optional()];
  });
  const shape = Object.fromEntries(entries) satisfies BuildSelectShape<
    T["shape"]
  >;
  return z.object<BuildSelectShape<T["shape"]>>(shape);
}
