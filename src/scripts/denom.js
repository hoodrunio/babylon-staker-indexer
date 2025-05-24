const axios = require('axios');

// Configuration
const LCD_ENDPOINT = 'https://babylon.nodes.guru/api';

async function getAllTokenBaseDenoms() {
    try {
        console.log('Scanning network for all tokens...\n');

        // 1. Get all token supply
        console.log('Fetching token supply...');
        const supplyResponse = await axios.get(`${LCD_ENDPOINT}/cosmos/bank/v1beta1/supply`);
        const allTokens = supplyResponse.data.supply;
        
        console.log(`Found ${allTokens.length} total tokens\n`);

        // 2. Separate native and IBC tokens
        const nativeTokens = allTokens.filter(token => !token.denom.startsWith('ibc/'));
        const ibcTokens = allTokens.filter(token => token.denom.startsWith('ibc/'));

        console.log('NATIVE TOKENS:');
        console.log('================');
        nativeTokens.forEach(token => {
            console.log(`• ${token.denom} (Supply: ${formatAmount(token.amount)})`);
        });

        console.log('\nIBC TOKENS:');
        console.log('==============');

        // 3. Process IBC tokens to get base denoms
        for (const token of ibcTokens) {
            const hash = token.denom.split('ibc/')[1];
            
            try {
                console.log(`\nProcessing: ${token.denom}`);
                
                // Get denom trace
                const traceResponse = await axios.get(
                    `${LCD_ENDPOINT}/ibc/apps/transfer/v1/denom_traces/${hash}`
                );
                
                const trace = traceResponse.data.denom_trace;
                
                console.log(`   Path: ${trace.path}`);
                console.log(`   Base Denom: ${trace.base_denom}`);
                console.log(`   Supply: ${formatAmount(token.amount)}`);
                
                // Parse the path to show hops
                const hops = parsePath(trace.path);
                if (hops.length > 0) {
                    console.log(`   Hops: ${hops.map(h => `${h.port}/${h.channel}`).join(' -> ')}`);
                }
                
            } catch (error) {
                console.log(`   Error getting trace: ${error.message}`);
            }
            
            // Add small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // 4. Summary
        console.log('\nSUMMARY:');
        console.log('===========');
        console.log(`Total tokens: ${allTokens.length}`);
        console.log(`Native tokens: ${nativeTokens.length}`);
        console.log(`IBC tokens: ${ibcTokens.length}`);
        
        // Unique base denoms
        const uniqueBaseDenoms = new Set();
        nativeTokens.forEach(token => uniqueBaseDenoms.add(token.denom));
        
        for (const token of ibcTokens) {
            const hash = token.denom.split('ibc/')[1];
            try {
                const traceResponse = await axios.get(
                    `${LCD_ENDPOINT}/ibc/applications/transfer/v1/denom_traces/${hash}`
                );
                uniqueBaseDenoms.add(traceResponse.data.denom_trace.base_denom);
            } catch (error) {
                // Skip failed traces
            }
        }
        
        console.log(`\nUNIQUE BASE DENOMS (${uniqueBaseDenoms.size}):`);
        console.log('========================');
        [...uniqueBaseDenoms].sort().forEach(denom => {
            console.log(`• ${denom}`);
        });

    } catch (error) {
        console.error('Error:', error.message);
        
        if (error.response) {
            console.error('Response status:', error.response.status);
            console.error('Response data:', error.response.data);
        }
    }
}

function parsePath(path) {
    if (!path) return [];
    
    const parts = path.split('/');
    const hops = [];
    
    for (let i = 0; i < parts.length; i += 2) {
        if (parts[i] && parts[i + 1]) {
            hops.push({
                port: parts[i],
                channel: parts[i + 1]
            });
        }
    }
    
    return hops;
}

function formatAmount(amount) {
    // Convert to human readable format
    const num = parseInt(amount);
    if (num >= 1e9) {
        return (num / 1e9).toFixed(2) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(2) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(2) + 'K';
    }
    return num.toString();
}

// Run the script
console.log('Starting IBC Token Scanner...\n');
getAllTokenBaseDenoms()
    .then(() => {
        console.log('\nScan completed!');
    })
    .catch(error => {
        console.error('Script failed:', error.message);
    });