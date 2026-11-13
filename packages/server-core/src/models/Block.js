import mongoose from 'mongoose';

const BlockSchema = new mongoose.Schema(
  {
    blockerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    blockedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

BlockSchema.index({ blockerId: 1, blockedId: 1 }, { unique: true });

export const Block = mongoose.models.Block || mongoose.model('Block', BlockSchema);
export default Block;
