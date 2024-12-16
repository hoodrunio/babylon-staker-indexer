#!/usr/bin/env python3

import json
import requests
from typing import Dict, Any, Optional

class BabylonTxDebugger:
    def __init__(self, rpc_url: str):
        self.rpc_url = rpc_url
        
    def _rpc_call(self, method: str, params: list) -> Any:
        """Make a Bitcoin RPC call"""
        headers = {'content-type': 'application/json'}
        payload = {
            "jsonrpc": "1.0",
            "id": "btc",
            "method": method,
            "params": params
        }
        
        response = requests.post(self.rpc_url, json=payload, headers=headers)
        if response.status_code != 200:
            raise Exception(f"RPC call failed: {response.text}")
            
        result = response.json()
        if 'error' in result and result['error'] is not None:
            raise Exception(f"RPC error: {result['error']}")
            
        return result['result']

    def parse_op_return(self, hex_data: str) -> Optional[Dict[str, Any]]:
        """Parse Babylon OP_RETURN data"""
        try:
            # Check prefix (0x6a = OP_RETURN, 0x47 = PUSH71, Tag = 62626e31)
            if not hex_data.startswith('6a4762626e31'):
                print("Invalid prefix")
                return None
            
            print("\nOP_RETURN Parsing:")
            print(f"Full hex: {hex_data}")
            print(f"Prefix (6a4762626e31): {hex_data[:12]}")
            
            # Remove prefix
            data = hex_data[12:]  # Skip 6a4762626e31
            print(f"\nRemaining data: {data}")
            
            # Parse version (2 bytes)
            version = int(data[:2], 16)
            print(f"Version bytes: {data[:2]}")
            print(f"Parsed version: {version}")
            
            # Parse staker public key (32 bytes)
            staker_pk = data[2:66]
            print(f"\nStaker PK bytes: {staker_pk}")
            
            # Parse finality provider public key (32 bytes)
            fp_pk = data[66:130]
            print(f"\nFinality Provider PK bytes: {fp_pk}")
            
            # Parse staking time (2 bytes)
            staking_time = int(data[130:134], 16)
            print(f"\nStaking time bytes: {data[130:134]}")
            print(f"Parsed staking time: {staking_time}")
            
            return {
                'version': version,
                'staker_public_key': staker_pk,
                'finality_provider': fp_pk,
                'staking_time': staking_time
            }
            
        except Exception as e:
            print(f"Error parsing OP_RETURN: {str(e)}")
            return None

    def debug_transaction(self, txid: str) -> None:
        """Debug a specific transaction"""
        try:
            # Get raw transaction
            tx = self._rpc_call('getrawtransaction', [txid, True])
            
            print(f"\n{'='*80}")
            print(f"Analyzing Transaction: {txid}")
            print(f"{'='*80}")
            
            # Basic transaction info
            print("\nBasic Information:")
            print(f"Block Hash: {tx.get('blockhash', 'unknown')}")
            block = self._rpc_call('getblock', [tx['blockhash']])
            print(f"Block Height: {block.get('height', 'unknown')}")
            print(f"Block Time: {block.get('time', 'unknown')}")
            
            # Analyze outputs
            print("\nOutputs Analysis:")
            for i, vout in enumerate(tx.get('vout', [])):
                print(f"\nOutput #{i}:")
                print(f"Value: {vout.get('value', 0)} BTC")
                print(f"Type: {vout['scriptPubKey'].get('type', 'unknown')}")
                
                if vout['scriptPubKey'].get('type') == 'witness_v1_taproot':
                    print("This is the stake output (Taproot)")
                    stake_amount_btc = vout.get('value', 0)
                    stake_amount_sat = int(stake_amount_btc * 100000000)
                    print(f"Stake amount: {stake_amount_btc} BTC ({stake_amount_sat} satoshi)")
                
                if vout['scriptPubKey'].get('type') == 'nulldata':
                    print("This is the OP_RETURN output")
                    hex_data = vout['scriptPubKey'].get('hex', '')
                    print(f"Raw hex: {hex_data}")
                    
                    # Parse OP_RETURN data
                    parsed = self.parse_op_return(hex_data)
                    if parsed:
                        print("\nParsed OP_RETURN data:")
                        for key, value in parsed.items():
                            print(f"{key}: {value}")
                
                if 'address' in vout['scriptPubKey']:
                    print(f"Address: {vout['scriptPubKey']['address']}")
            
            print("\nValidation Summary:")
            print(f"Total Outputs: {len(tx.get('vout', []))}")
            if len(tx.get('vout', [])) != 3:
                print("❌ Invalid: Must have exactly 3 outputs")
            else:
                print("✅ Has exactly 3 outputs")
            
            # Check first output is Taproot
            first_output = tx['vout'][0]
            if first_output['scriptPubKey'].get('type') == 'witness_v1_taproot':
                print("✅ First output is Taproot")
            else:
                print("❌ First output is not Taproot")
            
            # Check second output is OP_RETURN
            second_output = tx['vout'][1]
            if second_output['scriptPubKey'].get('type') == 'nulldata':
                print("✅ Second output is OP_RETURN")
            else:
                print("❌ Second output is not OP_RETURN")
            
        except Exception as e:
            print(f"Error debugging transaction: {str(e)}")

def main():
    # Sample transactions from different phases
    sample_txs = {
        "Phase 1 (Version 0)": [
            "cbe37da1b764cae11bda1bc9ca27f9d5727b37a5a103bc38be2167f5b7d06a98",  # Small stake
            "1bb0cc1f14c7c532e97288a75b1940e90e4466969e95e53933665f997a62c8d1"   # Small stake
        ],
        "Phase 2 (Version 1)": [
            "a5daf25b85f82de6f93bc08c19abc3d45beeef3fd6d3dac69bf641c061bdcbec",  # 500 BTC stake
            "7d90210b21aad480cd88fd8399aa6d47e6b3f2ecea2f9f9cfdd79598430e3003"   # 500 BTC stake
        ],
        "Phase 3 (Version 2)": [
            "214dd01222e2a135b6478353358b6d44ca8cff3bf7596e7f0da024d9703d0282",
            "91a1a3d0f277332870ce86dff523db2d6f9464604c072f50b300f1271123b87a"
        ]
    }
    
    # Initialize debugger with RPC URL from environment
    from dotenv import load_dotenv
    import os
    load_dotenv()
    
    rpc_url = os.getenv('BTC_RPC_URL')
    if not rpc_url:
        print("Error: BTC_RPC_URL not found in environment")
        return
    
    debugger = BabylonTxDebugger(rpc_url)
    
    # Debug each transaction
    for phase, txids in sample_txs.items():
        print(f"\n\n{'#'*80}")
        print(f"Analyzing {phase} Transactions")
        print(f"{'#'*80}")
        
        for txid in txids:
            debugger.debug_transaction(txid)

if __name__ == "__main__":
    main()
