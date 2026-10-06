type PagePlaceholderProps = {
  title: string;
  description: string;
};

export function PagePlaceholder({
  title,
  description,
}: PagePlaceholderProps) {
  return (
    <section className="page-placeholder" aria-labelledby="page-title">
      <h1 id="page-title">{title}</h1>
      <p>{description}</p>
      <p className="placeholder-note">This page is a placeholder.</p>
    </section>
  );
}
