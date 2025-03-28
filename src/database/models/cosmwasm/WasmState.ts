import mongoose, { Document, Schema, Model } from 'mongoose';

/**
 * Interface for WasmState document
 */
export interface IWasmState extends Document {
  _id: string;               // Unique identifier for this state
  lastFullIndexAt?: Date;    // Last full index timestamp
  lastIncrementalIndexAt?: Date; // Last incremental index timestamp
  totalCodes: number;        // Total number of codes indexed
  totalContracts: number;    // Total number of contracts indexed
  updatedAt: Date;           // Last update timestamp
  additionalData?: Record<string, any>; // Additional data for the indexer
}

/**
 * Interface for WasmState model with static methods
 */
export interface IWasmStateModel extends Model<IWasmState> {
  getOrCreate(id: string): Promise<IWasmState>;
}

/**
 * Schema for WasmState
 */
const wasmStateSchema = new Schema<IWasmState>(
  {
    _id: { type: String, required: true }, // We'll use string IDs like 'mainnet', 'testnet'
    lastFullIndexAt: { type: Date },
    lastIncrementalIndexAt: { type: Date },
    totalCodes: { type: Number, required: true, default: 0 },
    totalContracts: { type: Number, required: true, default: 0 },
    updatedAt: { type: Date, required: true, default: Date.now },
    additionalData: { type: Schema.Types.Mixed } // Flexible additional data field
  },
  {
    timestamps: true, // Adds createdAt and updatedAt timestamps
    versionKey: false // Don't add __v field
  }
);

/**
 * Static helper method to get or create a state document
 */
wasmStateSchema.statics.getOrCreate = async function(id: string): Promise<IWasmState> {
  let state = await this.findById(id);
  
  if (!state) {
    state = new this({
      _id: id,
      updatedAt: new Date()
    });
    await state.save();
  }
  
  return state;
};

// Compile and export the model
export const WasmState = mongoose.model<IWasmState, IWasmStateModel>('WasmState', wasmStateSchema, 'wasm_states'); 