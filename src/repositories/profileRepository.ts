import { PrismaClient, Profile } from "@prisma/client";

const prisma = new PrismaClient();

export type UpsertProfileInput = {
  userId: string;
  displayName?: string | null;
  bio?: string | null;
  website?: string | null;
  timezone?: string | null;
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
