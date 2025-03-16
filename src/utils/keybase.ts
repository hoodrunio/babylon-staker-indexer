export async function getKeybaseLogo(identity: string): Promise<string | null> {

    try {
      const response = await fetch(
        `https://keybase.io/_/api/1.0/user/lookup.json?key_suffix=${identity}&fields=pictures`
      );
      const data = await response.json() as {
        status: { code: number };
        them: {
          pictures: {
            primary: { url: string }
          }
        }[]
      };
  
      // Check status and them array
      if (data.status?.code !== 0 || !data.them?.[0]?.pictures?.primary?.url) {
        return null;
      }
  
      const logoUrl = data.them[0].pictures.primary.url;
    
      return logoUrl;
    } catch (error) {
      console.error('Error fetching Keybase logo:', error);
      return null;
    }
  } 