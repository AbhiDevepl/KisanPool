import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Button, Chip, Spinner, Surface, useThemeColor } from "heroui-native";
import { Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";

export default function Home() {
  const healthCheck = useQuery(trpc.healthCheck.queryOptions());
  const successColor = useThemeColor("success");
  const dangerColor = useThemeColor("danger");

  const isConnected = healthCheck?.data === "OK";
  const isLoading = healthCheck?.isLoading;

  return (
    <Container className="p-4">
      <View className="py-6 mb-4">
        <Text className="text-3xl font-semibold text-foreground tracking-tight">
          Better Fullstack
        </Text>
        <Text className="text-muted text-sm mt-1">Full-stack TypeScript starter</Text>
      </View>

      <Surface variant="secondary" className="p-4 rounded-lg">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-foreground font-medium">System Status</Text>
          <Chip variant="secondary" color={isConnected ? "success" : "danger"} size="sm">
            <Chip.Label>{isConnected ? "LIVE" : "OFFLINE"}</Chip.Label>
          </Chip>
        </View>

        <View className="h-px bg-border mb-3" />

        <Surface variant="tertiary" className="p-3 rounded-md">
          <View className="flex-row items-center">
            <View
              className={`w-2 h-2 rounded-full mr-3 ${isConnected ? "bg-success" : "bg-muted"}`}
            />
            <View className="flex-1">
              <Text className="text-foreground text-sm font-medium">TRPC Backend</Text>
              <Text className="text-muted text-xs mt-0.5">
                {isLoading
                  ? "Checking connection..."
                  : isConnected
                    ? "Connected to API"
                    : "API Disconnected"}
              </Text>
            </View>
            {isLoading && <Spinner size="sm" />}
            {!isLoading && isConnected && (
              <Ionicons name="checkmark-circle" size={18} color={successColor} />
            )}
            {!isLoading && !isConnected && (
              <Ionicons name="close-circle" size={18} color={dangerColor} />
            )}
          </View>
        </Surface>
      </Surface>
    </Container>
  );
}
