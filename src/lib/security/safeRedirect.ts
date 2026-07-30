
export function isSafeRedirectTarget(url: string, allowedOrigins: string[]): boolean {
  if (!url) return false;

  
  if (url.startsWith('//')) {
    return false;
  }

  
  if (url.startsWith('/') && !url.startsWith('\\')) {
    return true;
  }

  try {
    
    const parsedUrl = new URL(url);

    
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return false;
    }

    
    return allowedOrigins.includes(parsedUrl.origin);
  } catch (error) {
    
    return false;
  }
}
