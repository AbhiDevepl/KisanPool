import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ActivityIndicator, Alert, Pressable, Text, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";

export default function Matches() {
  const { requestId } = useLocalSearchParams<{ requestId: string }>();

  const matches = useQuery(
    trpc.transport.findMatches.queryOptions({ requestId: requestId ?? "" }),
  );

  const acceptMatch = useMutation(
    trpc.transport.acceptMatch.mutationOptions({
      onSuccess: () => {
        Alert.alert("Match accepted", "The vehicle has been booked. Cost split is locked in.");
        matches.refetch();
      },
      onError: (error) => {
        Alert.alert("Error", error.message);
      },
    }),
  );

  if (matches.isLoading) {
    return (
      <Container className="p-4 items-center justify-center">
        <ActivityIndicator />
        <Text className="text-muted mt-3">Finding compatible vehicles...</Text>
      </Container>
    );
  }

  if (matches.isError) {
    return (
      <Container className="p-4">
        <Text className="text-danger text-base mb-4">Could not load matches.</Text>
        <Text className="text-muted">{matches.error.message}</Text>
        <Pressable className="mt-6 bg-primary rounded-xl py-3 items-center" onPress={() => matches.refetch()}>
          <Text className="text-white font-semibold">Retry</Text>
        </Pressable>
      </Container>
    );
  }

  const data = matches.data;
  if (!data) {
    return (
      <Container className="p-4 items-center justify-center">
        <ActivityIndicator />
      </Container>
    );
  }
  return (
    <Container className="p-4">
      <Text className="text-2xl font-semibold text-foreground mb-1">Matching Vehicles</Text>
      <Text className="text-muted text-sm mb-5">
        {data.request.cropType} · {data.request.quantityKg} kg · {data.request.pickupAddress} → {data.request.dropoffAddress}
      </Text>

      {data.matches.length === 0 ? (
        <View className="rounded-xl border border-border p-6 items-center">
          <Text className="text-foreground font-medium mb-1">No compatible vehicle</Text>
          <Text className="text-muted text-sm text-center">
            No truck has enough capacity ({data.request.quantityKg} kg) for this request.
          </Text>
        </View>
      ) : (
        data.matches.map((m) => (
          <View key={m.vehicle.id} className="rounded-xl border border-border p-4 mb-4 bg-surface">
            <View className="flex-row justify-between items-center mb-2">
              <View>
                <Text className="text-foreground font-semibold text-base">{m.vehicle.driverName}</Text>
                <Text className="text-muted text-xs">
                  {m.vehicle.vehicleType} · capacity {m.vehicle.capacityKg} kg · ₹{m.vehicle.ratePerKm}/km
                </Text>
              </View>
              <View className="bg-primary/15 rounded-full px-2.5 py-1">
                <Text className="text-primary font-bold text-sm">Score {m.matchScore}</Text>
              </View>
            </View>

            <View className="h-px bg-border my-3" />

            <View className="flex-row justify-between">
              <View>
                <Text className="text-muted text-xs">Distance</Text>
                <Text className="text-foreground font-medium">{m.distanceKm} km</Text>
              </View>
              <View>
                <Text className="text-muted text-xs">Total cost</Text>
                <Text className="text-foreground font-medium">₹{m.totalCost}</Text>
              </View>
              <View>
                <Text className="text-muted text-xs">Farmer pays</Text>
                <Text className="text-foreground font-medium">₹{m.farmerShare}</Text>
              </View>
              <View>
                <Text className="text-muted text-xs">Driver gets</Text>
                <Text className="text-foreground font-medium">₹{m.driverShare}</Text>
              </View>
            </View>

            <Pressable
              className="mt-4 bg-primary rounded-xl py-3 items-center active:opacity-80"
              onPress={() => acceptMatch.mutate({ requestId: requestId!, vehicleId: m.vehicle.id })}
              disabled={acceptMatch.isPending || data.request.status === "MATCHED"}
            >
              {acceptMatch.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white font-semibold">
                  {data.request.status === "MATCHED" ? "Request already matched" : "Accept & Book"}
                </Text>
              )}
            </Pressable>
          </View>
        ))
      )}
    </Container>
  );
}