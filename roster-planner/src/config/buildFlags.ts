// © 2026 David Juste. All rights reserved. Proprietary and confidential.
//
// A release build must start empty, with no real staff names anywhere
// (SPEC.md §22, test T15). Seed data (SPEC.md §16) is real staff names and
// is development/test only, so it is gated on the JS dev flag, which is
// false in a release/production build.

export const ALLOW_DEV_SEED_DATA = __DEV__;
