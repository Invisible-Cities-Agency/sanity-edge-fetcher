import { fetchers } from '@invisible-cities/sanity-edge-fetcher/config';

// Example: Static page with long cache
export default async function HomePage() {
  // Fetch with 24-hour cache
  const settings = await fetchers.static('*[_type == "siteSettings"][0]');
  
  // Fetch with standard cache (60s)
  const posts = await fetchers.cached(
    '*[_type == "post"] | order(_createdAt desc)[0..10]'
  );
  
  return (
    <div>
      <h1>{settings.title}</h1>
      <div>
        {posts.map((post: any) => (
          <article key={post._id}>
            <h2>{post.title}</h2>
            <p>{post.excerpt}</p>
          </article>
        ))}
      </div>
    </div>
  );
}