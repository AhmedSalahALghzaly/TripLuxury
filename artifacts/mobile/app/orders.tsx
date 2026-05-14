import { Redirect } from 'expo-router';

export default function OrdersRedirect() {
  return <Redirect href={{ pathname: '/(tabs)/cart', params: { tab: 'orders' } }} />;
}
