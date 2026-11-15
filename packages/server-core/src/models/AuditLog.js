import mongoose from 'mongoose';
import { AppError, ERROR_CODES } from '@borrowloop/shared';

const AuditLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    actorRole: {
      type: String,
      required: true,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      required: true,
      index: true,
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    ip: {
      type: String,
      default: 'unknown',
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false }, // Append-only
  },
);

// Helper invariant error
function throwAppendOnlyError(operation) {
  throw new AppError(
    ERROR_CODES.INTERNAL_ERROR,
    `AuditLog entries are strictly immutable and append-only. Operation '${operation}' is prohibited.`,
    500,
  );
}

// Block modifications on document save
AuditLogSchema.pre('save', function (next) {
  if (!this.isNew) {
    return next(
      new AppError(
        ERROR_CODES.INTERNAL_ERROR,
        'AuditLog entries are strictly immutable. Modifying existing entries is prohibited.',
        500,
      ),
    );
  }
  next();
});

// Block update queries
const blockedUpdateQueries = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'replaceOne',
];
for (const queryName of blockedUpdateQueries) {
  AuditLogSchema.pre(queryName, function () {
    throwAppendOnlyError(queryName);
  });
}

// Block delete queries
const blockedDeleteQueries = ['deleteOne', 'deleteMany', 'findOneAndDelete'];
for (const queryName of blockedDeleteQueries) {
  AuditLogSchema.pre(queryName, function () {
    throwAppendOnlyError(queryName);
  });
}

export const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export default AuditLog;
