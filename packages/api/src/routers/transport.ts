import { z } from "zod";
import { publicProcedure, router } from "../index";
import prisma from "@my-app/db";

const haversineKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};

const vehicleCapacityMatch = (vehicleType: string, quantityKg: number): boolean => {
  const capacities: Record<string, number> = {
    TRUCK_SMALL: 1000,
    TRUCK_MEDIUM: 5000,
    TRUCK_LARGE: 15000,
    TEMPO: 750,
    TRACTOR_TROLLEY: 2000,
  };
  return (capacities[vehicleType] ?? 0) >= quantityKg;
};

const calculateMatchScore = (
  vehicleLat: number,
  vehicleLng: number,
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
  vehicleCapacity: number,
  requestQuantity: number
): number => {
  const pickupDistance = haversineKm(vehicleLat, vehicleLng, pickupLat, pickupLng);
  const tripDistance = haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  const capacityUtilization = requestQuantity / vehicleCapacity;
  const distanceScore = Math.max(0, 100 - pickupDistance * 2);
  const capacityScore = capacityUtilization * 100;
  return Math.round((distanceScore * 0.6 + capacityScore * 0.4) * 100) / 100;
};

export const transportRouter = router({
  createRequest: publicProcedure
    .input(
      z.object({
        farmerId: z.string().min(1),
        cropType: z.string().min(1),
        quantityKg: z.number().int().positive(),
        pickupLat: z.number(),
        pickupLng: z.number(),
        dropoffLat: z.number(),
        dropoffLng: z.number(),
        pickupAddress: z.string().min(1),
        dropoffAddress: z.string().min(1),
        preferredDate: z.string().datetime(),
      })
    )
    .mutation(async ({ input }) => {
      const request = await prisma.transportRequest.create({
        data: {
          ...input,
          preferredDate: new Date(input.preferredDate),
        },
      });
      return request;
    }),

  findMatches: publicProcedure
    .input(z.object({ requestId: z.string() }))
    .query(async ({ input }) => {
      const request = await prisma.transportRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request) throw new Error("Request not found");

      const vehicles = await prisma.vehicle.findMany({
        where: { isAvailable: true },
      });

      const matches = vehicles
        .filter((v) => vehicleCapacityMatch(v.vehicleType, request.quantityKg))
        .map((vehicle) => {
          const tripDistance = haversineKm(
            request.pickupLat,
            request.pickupLng,
            request.dropoffLat,
            request.dropoffLng
          );
          const totalCost = Math.round(tripDistance * vehicle.ratePerKm * 100) / 100;
          const farmerShare = Math.round(totalCost * 0.6 * 100) / 100;
          const driverShare = Math.round(totalCost * 0.4 * 100) / 100;
          const matchScore = calculateMatchScore(
            vehicle.currentLat,
            vehicle.currentLng,
            request.pickupLat,
            request.pickupLng,
            request.dropoffLat,
            request.dropoffLng,
            vehicle.capacityKg,
            request.quantityKg
          );

          return {
            vehicle,
            matchScore,
            distanceKm: Math.round(tripDistance * 100) / 100,
            totalCost,
            farmerShare,
            driverShare,
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3);

      return { request, matches };
    }),

  acceptMatch: publicProcedure
    .input(
      z.object({
        requestId: z.string(),
        vehicleId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const request = await prisma.transportRequest.findUnique({
        where: { id: input.requestId },
      });
      if (!request) throw new Error("Request not found");

      const vehicle = await prisma.vehicle.findUnique({
        where: { id: input.vehicleId },
      });
      if (!vehicle) throw new Error("Vehicle not found");

      const tripDistance = haversineKm(
        request.pickupLat,
        request.pickupLng,
        request.dropoffLat,
        request.dropoffLng
      );
      const totalCost = Math.round(tripDistance * vehicle.ratePerKm * 100) / 100;
      const farmerShare = Math.round(totalCost * 0.6 * 100) / 100;
      const driverShare = Math.round(totalCost * 0.4 * 100) / 100;
      const matchScore = calculateMatchScore(
        vehicle.currentLat,
        vehicle.currentLng,
        request.pickupLat,
        request.pickupLng,
        request.dropoffLat,
        request.dropoffLng,
        vehicle.capacityKg,
        request.quantityKg
      );

      const match = await prisma.match.create({
        data: {
          requestId: input.requestId,
          vehicleId: input.vehicleId,
          matchScore,
          distanceKm: Math.round(tripDistance * 100) / 100,
          totalCost,
          farmerShare,
          driverShare,
          status: "ACCEPTED",
        },
        include: { request: true, vehicle: true },
      });

      await prisma.transportRequest.update({
        where: { id: input.requestId },
        data: { status: "MATCHED" },
      });

      await prisma.vehicle.update({
        where: { id: input.vehicleId },
        data: { isAvailable: false },
      });

      return match;
    }),

  getMatch: publicProcedure
    .input(z.object({ matchId: z.string() }))
    .query(async ({ input }) => {
      const match = await prisma.match.findUnique({
        where: { id: input.matchId },
        include: { request: true, vehicle: true },
      });
      if (!match) throw new Error("Match not found");
      return match;
    }),

  seedVehicles: publicProcedure.mutation(async () => {
    const vehicles = [
      {
        driverId: "driver-1",
        driverName: "Rajesh Kumar",
        vehicleType: "TRUCK_MEDIUM" as const,
        capacityKg: 5000,
        currentLat: 28.6139,
        currentLng: 77.209,
        baseLat: 28.6139,
        baseLng: 77.209,
        ratePerKm: 25,
        isAvailable: true,
      },
      {
        driverId: "driver-2",
        driverName: "Amit Singh",
        vehicleType: "TRUCK_SMALL" as const,
        capacityKg: 1000,
        currentLat: 28.7041,
        currentLng: 77.1025,
        baseLat: 28.7041,
        baseLng: 77.1025,
        ratePerKm: 18,
        isAvailable: true,
      },
      {
        driverId: "driver-3",
        driverName: "Suresh Yadav",
        vehicleType: "TEMPO" as const,
        capacityKg: 750,
        currentLat: 28.5355,
        currentLng: 77.391,
        baseLat: 28.5355,
        baseLng: 77.391,
        ratePerKm: 15,
        isAvailable: true,
      },
      {
        driverId: "driver-4",
        driverName: "Mohan Lal",
        vehicleType: "TRACTOR_TROLLEY" as const,
        capacityKg: 2000,
        currentLat: 28.4595,
        currentLng: 77.0266,
        baseLat: 28.4595,
        baseLng: 77.0266,
        ratePerKm: 12,
        isAvailable: true,
      },
    ];

    await prisma.vehicle.deleteMany();
    const created = await prisma.vehicle.createMany({ data: vehicles });
    return { count: created.count };
  }),
});

export type TransportRouter = typeof transportRouter;