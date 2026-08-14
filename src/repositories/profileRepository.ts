import { PrismaClient, Profile } from "@prisma/client";

import { type ProfileUpdateInput } from "../validation/accountSchemas.js";

const prisma = new PrismaClient();

export type UpsertProfileInput = ProfileUpdateInput & {
  userId: string;
};

/**
 * Upserts a user profile: creates the record on first write or updates existing fields on subsequent writes.
 */
export async function upsertProfile(data: UpsertProfileInput): Promise<Profile> {
  const { userId, ...updateData } = data;

  return prisma.profile.upsert({
    where: { userId },
    create: {
      userId,
      ...updateData,
    },
    update: {
      ...updateData,
    },
  });
}

/**
 * Retrieves a user profile by unique userId.
 */
export async function getProfileByUserId(userId: string): Promise<Profile | null> {
  return prisma.profile.findUnique({
    where: { userId },
  });
}
