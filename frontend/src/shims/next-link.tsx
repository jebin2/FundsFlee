// Shim for `next/link` backed by react-router's Link.
import { Link as RRLink } from "react-router-dom";
import type { ComponentProps, ReactNode } from "react";

type AnchorProps = Omit<ComponentProps<"a">, "href">;

interface NextLinkProps extends AnchorProps {
  href: string;
  children?: ReactNode;
  // Next-only props we accept and ignore:
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
}

export default function Link({ href, children, prefetch, scroll, shallow, replace, ...rest }: NextLinkProps) {
  void prefetch; void scroll; void shallow;
  return (
    <RRLink to={href} replace={replace} {...rest}>
      {children}
    </RRLink>
  );
}
