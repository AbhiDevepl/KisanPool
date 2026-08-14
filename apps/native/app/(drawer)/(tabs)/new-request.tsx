import { useMutation } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from "react-native";

import { Container } from "@/components/container";
import { trpc } from "@/utils/trpc";

const fieldClass =
  "border border-border rounded-lg px-3 py-2.5 text-foreground bg-surface text-sm";
const labelClass = "text-sm font-medium text-foreground mb-1";

export default function NewRequest() {
  const router = useRouter();
  const [farmerId, setFarmerId] = useState("farmer-1");
  const [cropType, setCropType] = useState("Wheat");
  const [quantityKg, setQuantityKg] = useState("800");
  const [pickupLat, setPickupLat] = useState("28.6139");
  const [pickupLng, setPickupLng] = useState("77.209");
  const [dropoffLat, setDropoffLat] = useState("28.7041");
  const [dropoffLng, setDropoffLng] = useState("77.1025");
  const [pickupAddress, setPickupAddress] = useState("Delhi Mandi, Azadpur");
  const [dropoffAddress, setDropoffAddress] = useState("Gurgaon Grain Market");

  const createRequest = useMutation(
    trpc.transport.createRequest.mutationOptions({
      onSuccess: (request) => {
        router.push(`/matches?requestId=${request.id}`);
      },
      onError: (error) => {
        Alert.alert("Error", error.message);
      },
    }),
  );

  const submit = () => {
    const quantity = parseInt(quantityKg, 10);
    if (!quantity || quantity <= 0) {
      Alert.alert("Invalid input", "Quantity must be a positive number (kg).");
      return;
    }
    createRequest.mutate({
      farmerId,
      cropType,
      quantityKg: quantity,
      pickupLat: parseFloat(pickupLat),
      pickupLng: parseFloat(pickupLng),
      dropoffLat: parseFloat(dropoffLat),
      dropoffLng: parseFloat(dropoffLng),
      pickupAddress,
      dropoffAddress,
      preferredDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  };

  return (
    <Container className="p-4">
      <Text className="text-2xl font-semibold text-foreground mb-1">New Transport Request</Text>
      <Text className="text-muted text-sm mb-6">
        Tell us what you need to move and we will find matching trucks.
      </Text>

      <View className="space-y-4">
        <View>
          <Text className={labelClass}>Farmer ID</Text>
          <TextInput className={fieldClass} value={farmerId} onChangeText={setFarmerId} autoCapitalize="none" />
        </View>
        <View>
          <Text className={labelClass}>Crop Type</Text>
          <TextInput className={fieldClass} value={cropType} onChangeText={setCropType} />
        </View>
        <View>
          <Text className={labelClass}>Quantity (kg)</Text>
          <TextInput className={fieldClass} value={quantityKg} onChangeText={setQuantityKg} keyboardType="number-pad" />
        </View>

        <Text className="text-base font-semibold text-foreground mt-2">Pickup</Text>
        <View className="flex-row space-x-3">
          <View className="flex-1">
            <Text className={labelClass}>Latitude</Text>
            <TextInput className={fieldClass} value={pickupLat} onChangeText={setPickupLat} keyboardType="decimal-pad" />
          </View>
          <View className="flex-1">
            <Text className={labelClass}>Longitude</Text>
            <TextInput className={fieldClass} value={pickupLng} onChangeText={setPickupLng} keyboardType="decimal-pad" />
          </View>
        </View>
        <View>
          <Text className={labelClass}>Address</Text>
          <TextInput className={fieldClass} value={pickupAddress} onChangeText={setPickupAddress} />
        </View>

        <Text className="text-base font-semibold text-foreground mt-2">Drop-off</Text>
        <View className="flex-row space-x-3">
          <View className="flex-1">
            <Text className={labelClass}>Latitude</Text>
            <TextInput className={fieldClass} value={dropoffLat} onChangeText={setDropoffLat} keyboardType="decimal-pad" />
          </View>
          <View className="flex-1">
            <Text className={labelClass}>Longitude</Text>
            <TextInput className={fieldClass} value={dropoffLng} onChangeText={setDropoffLng} keyboardType="decimal-pad" />
          </View>
        </View>
        <View>
          <Text className={labelClass}>Address</Text>
          <TextInput className={fieldClass} value={dropoffAddress} onChangeText={setDropoffAddress} />
        </View>

        <Pressable
          className="mt-6 bg-primary rounded-xl py-3.5 items-center active:opacity-80"
          onPress={submit}
          disabled={createRequest.isPending}
        >
          {createRequest.isPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-white font-semibold text-base">
              Create Request &amp; Find Matches
            </Text>
          )}
        </Pressable>
      </View>
    </Container>
  );
}