import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { edgeSanityFetch } from '@invisible-cities/sanity-edge-fetcher';

export async function middleware(request: NextRequest) {
  // Works perfectly in Edge Middleware!
  const settings = await edgeSanityFetch({
    dataset: 'production',
    query: '*[_type == "siteSettings"][0]',
    useCdn: true
  });
  
  // Add custom headers based on CMS data
  const response = NextResponse.next();
  response.headers.set('X-Site-Name', settings.siteName);
  
  return response;
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
};