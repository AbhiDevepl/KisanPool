import { Card } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";

export default function Home() {
  return (
    <Container className="p-6">
      <View className="flex-1 justify-center items-center">
        <Card variant="secondary" className="p-8 items-center w-full">
          <Card.Title className="text-2xl mb-2 text-center">KisanPool Logistics</Card.Title>
          <Text className="text-muted text-sm text-center">
            Connect farmer produce with available nearby transport vehicles. Use the Request tab to initiate a new harvest booking.
          </Text>
        </Card>
      </View>
    </Container>
  );
}
