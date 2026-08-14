import { Card } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function TabTwo() {
  return (
    <Container className="p-6">
      <View className="flex-1 justify-center items-center">
        <Card variant="secondary" className="p-8 items-center w-full">
          <Card.Title className="text-2xl mb-2 text-center">Cost Split Model</Card.Title>
          <Text className="text-muted text-sm text-center">
            Trip costs are calculated automatically using trip distance and vehicle per-km rates. Total trip costs are split 60% (Farmer) / 40% (Driver).
          </Text>
        </Card>
      </View>
    </Container>
  );
}
