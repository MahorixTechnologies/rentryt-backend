import { ForbiddenException } from '@nestjs/common';

type RenterProfile = {
  emailVerified: boolean;
  phone: string | null;
  phoneVerified: boolean;
  identityVerified: boolean;
};

export function assertRenterBookingEligible(profile: RenterProfile) {
  if (!profile.emailVerified) {
    throw new ForbiddenException(
      'verify your email in account settings before booking',
    );
  }
  if (!profile.phone?.trim()) {
    throw new ForbiddenException(
      'add and verify your phone number before booking',
    );
  }
  if (!profile.phoneVerified) {
    throw new ForbiddenException(
      'verify your phone number before booking',
    );
  }
  if (!profile.identityVerified) {
    throw new ForbiddenException(
      'submit and verify your NIN or valid ID before booking',
    );
  }
}
