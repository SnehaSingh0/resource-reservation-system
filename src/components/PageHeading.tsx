import type { ReactNode } from "react";

type PageHeadingProps = {
  title: string;
  description: string;
  action?: ReactNode;
};

export function PageHeading({
  title,
  description,
  action,
}: PageHeadingProps) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </div>
  );
}
