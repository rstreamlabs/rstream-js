// See LICENSE file in the project root for license information.

import * as z from "zod";

export const StringFilter = z.union([
  z.string(),
  z.object({ exact: z.string() }),
  z.object({ oneof: z.array(z.string()) }),
  z.object({ regex: z.string() }),
]);

type Schema = z.core.SomeType;
type Shape = z.ZodRawShape;
type RecordKey = z.core.$ZodRecordKey;

type TransformProps<T extends Schema> =
  T extends z.ZodOptional<infer U extends Schema>
    ? TransformProps<U>
    : T extends z.ZodString
      ? z.ZodOptional<typeof StringFilter>
      : T extends z.ZodRecord<infer K extends RecordKey, infer V extends Schema>
        ? z.ZodOptional<z.ZodRecord<K, TransformProps<V>>>
        : z.ZodOptional<T>;

function transform(field: Schema): Schema {
  if (field instanceof z.ZodOptional) {
    return z.optional(transform(field.unwrap()));
  }
  if (field instanceof z.ZodString) {
    return z.optional(StringFilter);
  }
  if (field instanceof z.ZodRecord) {
    return z.optional(z.record(field.keyType, transform(field.valueType)));
  }
  return z.optional(field);
}

type Logical<T> = T | { AND: Logical<T>[] } | { OR: Logical<T>[] };

type FilterObject<S extends Shape> = z.output<
  z.ZodObject<{ [K in keyof S]: TransformProps<S[K]> }>
>;

export type FilterNode<S extends Shape> = Logical<FilterObject<S>>;

export function filters<T extends z.ZodObject<Shape>>(
  base: T,
): z.ZodType<FilterNode<T["shape"]>> {
  type S = T["shape"];
  type SchemaShape = { [K in keyof S]: TransformProps<S[K]> };
  const entries = Object.entries(base.shape).map(([key, field]) => [
    key,
    transform(field),
  ]);
  const shape: SchemaShape = Object.fromEntries(entries);
  const node: z.ZodType<FilterNode<S>> = z.lazy(
    (): z.ZodType<FilterNode<S>> =>
      z.union([
        z.object(shape),
        z.object({ AND: z.array(node) }),
        z.object({ OR: z.array(node) }),
      ]),
  );
  return node;
}

type BuildSelectShape<S extends Shape> = {
  [K in keyof S]: z.ZodOptional<z.ZodBoolean>;
};

export function select<T extends z.ZodObject<Shape>>(
  base: T,
): z.ZodObject<BuildSelectShape<T["shape"]>> {
  const entries = Object.entries(base.shape).map(([key]) => {
    return [key, z.boolean().optional()];
  });
  const shape: BuildSelectShape<T["shape"]> = Object.fromEntries(entries);
  return z.object<BuildSelectShape<T["shape"]>>(shape);
}
