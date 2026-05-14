import { demoGallery } from "@/lib/sampleData";

export function GalleryMockup() {
  return (
    <section className="card gallery-card">
      <div className="section-heading">
        <p className="eyebrow">Multimodal continuity</p>
        <h2>Image gallery</h2>
      </div>

      <div className="gallery-grid">
        {demoGallery.map((item) => (
          <article key={item.id} className="gallery-item">
            <div className="image-placeholder">{item.type === "generated" ? "AI" : "IMG"}</div>
            <div>
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
