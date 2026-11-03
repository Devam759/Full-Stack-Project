import mongoose from 'mongoose';

const CommunitySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      minlength: 2,
      maxlength: 60,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
      default: '',
    },
    type: {
      type: String,
      enum: ['public', 'private'],
      default: 'public',
      index: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        required: true,
      },
    },
    city: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    memberCount: {
      type: Number,
      default: 1,
      min: 0,
    },
    inviteCode: {
      type: String,
      select: false, // Protected: owner-only
      trim: true,
    },
    status: {
      type: String,
      enum: ['active', 'suspended', 'deleted'],
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    collation: { locale: 'en', strength: 2 }, // Case-insensitive collation for uniqueness and searches
  },
);

// Indexes
CommunitySchema.index({ location: '2dsphere' });
CommunitySchema.index({ name: 'text', description: 'text', city: 'text' });
CommunitySchema.index({ status: 1, city: 1 });

export const Community = mongoose.model('Community', CommunitySchema);
export default Community;
