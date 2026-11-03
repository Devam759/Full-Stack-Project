import mongoose from 'mongoose';

const MembershipSchema = new mongoose.Schema(
  {
    communityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Community',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['member', 'moderator', 'owner'],
      default: 'member',
    },
    status: {
      type: String,
      enum: ['active', 'pending', 'removed'],
      default: 'active',
      index: true,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  },
);

MembershipSchema.index({ communityId: 1, userId: 1 }, { unique: true });
MembershipSchema.index({ userId: 1, status: 1 });
MembershipSchema.index({ communityId: 1, status: 1 });

export const Membership = mongoose.model('Membership', MembershipSchema);
export default Membership;
