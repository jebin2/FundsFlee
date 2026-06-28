// Shim for `next/image` — plain <img>. Only Google avatar images are involved.
import type { ComponentProps } from "react";

interface NextImageProps extends Omit<ComponentProps<"img">, "src"> {
  src: string;
  // Next-only props we accept and ignore:
  fill?: boolean;
  priority?: boolean;
  quality?: number;
  sizes?: string;
  unoptimized?: boolean;
}

export default function Image({ fill, priority, quality, sizes, unoptimized, ...rest }: NextImageProps) {
  void fill; void priority; void quality; void sizes; void unoptimized;
  // eslint-disable-next-line @next/next/no-img-element
  return <img alt="" {...rest} />;
}
