export interface IBCPacket {
  sequence: string;
  source_port: string;
  source_channel: string;
  destination_port: string;
  destination_channel: string;
  data: string;
  timeout_height: {
    revision_number: string;
    revision_height: string;
  } | null;
  timeout_timestamp: string;
}

export interface PacketState {
  packet: IBCPacket;
  acknowledgement?: string;
  receipt?: boolean;
}

export interface UnreceivedPacketProof {
  proof: string;
  proof_height: {
    revision_number: string;
    revision_height: string;
  };
}

export interface TimeoutPacketRequest {
  channel_id: string;
  port_id: string;
  source_chain_id: string;
  destination_chain_id: string;
}

export interface TimeoutResult {
  success: boolean;
  message: string;
  cleared_packets: number;
  transaction_hashes: string[];
  errors: string[];
}

export interface ChainInfo {
  chain_id: string;
  rpc_url: string;
  grpc_url?: string;
  prefix: string;
}

export interface MsgTimeout {
  packet: IBCPacket;
  proof_unreceived: string;
  proof_height: {
    revision_number: string;
    revision_height: string;
  };
  next_sequence_recv: string;
  signer: string;
}

export interface ChannelEnd {
  state: string;
  ordering: string;
  counterparty: {
    port_id: string;
    channel_id: string;
  };
  connection_hops: string[];
  version: string;
} 