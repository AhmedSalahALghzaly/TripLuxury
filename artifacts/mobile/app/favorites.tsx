import { useEffect } from 'react';
import { useRouter } from 'expo-router';

export default function FavoritesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace({ pathname: '/(tabs)/cart', params: { tab: 'favorites' } });
  }, []);
  return null;
}
