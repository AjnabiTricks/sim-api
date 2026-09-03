export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { search } = req.query;

  if (!search) {
    return res.status(400).json({
      success: false,
      error: 'Please provide "search" parameter'
    });
  }

  // --- CLEAN INPUT ---
  let cleanInput = search.trim()
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\+/g, '');

  let isCNIC = /^[0-9]{13}$/.test(cleanInput);
  let phoneNumber = cleanInput;

  if (!isCNIC) {
    if (phoneNumber.startsWith('923')) phoneNumber = phoneNumber.substring(3);
    else if (phoneNumber.startsWith('92')) phoneNumber = phoneNumber.substring(2);
    if (/^3[0-9]{9}$/.test(phoneNumber)) phoneNumber = '0' + phoneNumber;
    else if (/^[0-9]{10}$/.test(phoneNumber) && phoneNumber.startsWith('3')) phoneNumber = '0' + phoneNumber;
    
    if (!/^03[0-9]{9}$/.test(phoneNumber)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid phone number. Must be 11 digits starting with 03'
      });
    }
  }

  try {
    console.log(`🔍 Searching for: ${phoneNumber}`);

    // =============================================
    // 📞 DIRECT API SEARCH (KingDB + Paksim)
    // =============================================
    async function searchViaKingDB(query) {
      try {
        const response = await fetch(`https://kingdb.xyz/api.php?query=${query}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (!response.ok) return [];
        
        const data = await response.json();
        console.log('KingDB Response:', JSON.stringify(data, null, 2));
        
        if (data.status && data.data && data.data.data) {
          return data.data.data.map(item => ({
            Name: item.nam || 'Unknown',
            Cnic: item.cni || 'N/A',
            Mobile: item.nbr || query,
            Address: item.adr || 'No address'
          }));
        }
        return [];
      } catch (error) {
        console.error('KingDB error:', error);
        return [];
      }
    }

    async function searchViaPaksim(query) {
      try {
        const response = await fetch('https://paksim.info/sim-database-online-2022-result.php', {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'origin': 'https://paksim.info',
            'referer': 'https://paksim.info/search.php'
          },
          body: new URLSearchParams({ cnnum: query })
        });

        if (!response.ok) return [];

        const html = await response.text();
        console.log(`Paksim HTML Length: ${html.length}`);
        
        // Check if no data
        if (html.includes('No record found') || html.includes('No data found')) {
          return [];
        }
        
        return parsePaksimHTML(html);
      } catch (error) {
        console.error('Paksim error:', error);
        return [];
      }
    }

    // =============================================
    // 🔍 SEARCH LOGIC - Try both sources
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    if (isCNIC) {
      // Try KingDB first
      let records = await searchViaKingDB(cleanInput);
      if (records.length === 0) {
        records = await searchViaPaksim(cleanInput);
      }
      if (records.length > 0) {
        allRecords = records;
        detectedCNIC = cleanInput;
      }
    } else {
      // Try KingDB first
      let phoneRecords = await searchViaKingDB(phoneNumber);
      
      // If KingDB fails, try Paksim
      if (phoneRecords.length === 0) {
        console.log('⚠️ KingDB failed, trying Paksim...');
        phoneRecords = await searchViaPaksim(phoneNumber);
      }
      
      if (phoneRecords.length > 0) {
        allRecords = phoneRecords;
        
        const cnis = getAllCNICs(phoneRecords);
        if (cnis.length > 0) {
          detectedCNIC = cnis[0];
          console.log(`📌 Found CNIC: ${detectedCNIC}`);
          
          // Now search by CNIC to get all numbers
          let cnicRecords = await searchViaKingDB(detectedCNIC);
          if (cnicRecords.length === 0) {
            cnicRecords = await searchViaPaksim(detectedCNIC);
          }
          
          if (cnicRecords.length > 0) {
            const existingNumbers = new Set(allRecords.map(r => r.Mobile));
            cnicRecords.forEach(record => {
              if (!existingNumbers.has(record.Mobile)) {
                allRecords.push(record);
                existingNumbers.add(record.Mobile);
              }
            });
            console.log(`✅ Merged ${cnicRecords.length} records from CNIC search`);
          }
        }
      }
    }

    // =============================================
    // 📊 PROCESS RESULTS
    // =============================================
    if (!allRecords || allRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No data found. Try another number.',
        query: search,
        suggestion: 'Number may not exist in database'
      });
    }

    // Remove duplicates
    const seen = new Set();
    const uniqueData = allRecords.filter(item => {
      const key = `${item.Cnic}_${item.Mobile}`;
      if (!seen.has(key)) {
        seen.add(key);
        return true;
      }
      return false;
    });

    console.log('📊 Final Records:', JSON.stringify(uniqueData, null, 2));

    // =============================================
    // 🔥 SMART FILTERS
    // =============================================
    const finalName = getSmartName(uniqueData);
    const bestAddress = getSmartAddress(uniqueData);
    const allNumbers = getAllNumbers(uniqueData);
    const allCNICs = getAllCNICs(uniqueData);

    // =============================================
    // 📦 FINAL RESPONSE
    // =============================================
    const finalResponse = {
      success: true,
      query: isCNIC ? cleanInput : phoneNumber,
      detectedType: isCNIC ? 'cnic' : 'phone',
      data: {
        name: finalName,
        allNumbers: allNumbers,
        cnic: allCNICs[0] || null,
        allCNICs: allCNICs,
        completeAddress: bestAddress,
        totalRecords: uniqueData.length,
        records: uniqueData.map(item => ({
          name: item.Name,
          cnic: item.Cnic,
          number: item.Mobile,
          address: item.Address
        }))
      },
      credit: "AZ Tricks",
      telegram: "https://t.me/AZ_Tricks"
    };

    return res.status(200).json(finalResponse);

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal Server Error',
      message: error.message
    });
  }
}

// =============================================
// 🔧 PAKSIM PARSER
// =============================================
function parsePaksimHTML(html) {
  try {
    const results = [];
    
    // Find table
    const tableRegex = /<table[^>]*>([\s\S]*?)<\/table>/gi;
    let tableMatch;
    
    while ((tableMatch = tableRegex.exec(html)) !== null) {
      const tableHTML = tableMatch[1];
      const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let rowMatch;
      let isHeader = true;
      
      while ((rowMatch = rowRegex.exec(tableHTML)) !== null) {
        if (isHeader) {
          isHeader = false;
          continue;
        }
        
        const cells = [];
        const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cellMatch;
        
        while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
          let content = cellMatch[1]
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          if (content) {
            cells.push(content);
          }
        }
        
        if (cells.length >= 3) {
          // Try to identify columns
          let name = 'N/A', cnic = 'N/A', mobile = 'N/A', address = 'N/A';
          
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.match(/^[0-9]{13}$/)) {
              cnic = cell;
            } else if (cell.match(/^03[0-9]{9}$/)) {
              mobile = cell;
            } else if (cell.match(/[A-Za-z]/) && cell.length > 2 && !cell.match(/^[0-9]+$/)) {
              if (name === 'N/A') {
                name = cell;
              } else {
                address = cell;
              }
            }
          }
          
          if (name !== 'N/A' && mobile !== 'N/A') {
            results.push({ Name: name, Cnic: cnic, Mobile: mobile, Address: address });
          }
        }
      }
    }
    
    return results;
  } catch (error) {
    console.error('Parser error:', error);
    return [];
  }
}

// =============================================
// 🔧 HELPER FUNCTIONS
// =============================================
function getSmartName(records) {
  const garbage = [
    'data not recieved from nadra', 
    'data not received from nadra', 
    'not received', 
    'no data', 
    'unknown', 
    'n/a', 
    'null', 
    'undefined', 
    'no', 
    '-',
    'cnic',
    'mobile',
    'address',
    'search'
  ];
  
  const names = records
    .map(r => r.Name)
    .filter(n => n && n.toString().trim().length > 0)
    .map(n => n.toString().trim());
  
  if (names.length === 0) return 'Unknown';
  
  const validNames = names.filter(name => {
    const lower = name.toLowerCase();
    return !garbage.some(g => lower.includes(g));
  });
  
  if (validNames.length === 0) {
    return names[0];
  }
  
  const nameCount = {};
  validNames.forEach(name => {
    nameCount[name] = (nameCount[name] || 0) + 1;
  });
  
  let mostCommon = validNames[0];
  let maxCount = 0;
  Object.keys(nameCount).forEach(name => {
    if (nameCount[name] > maxCount) {
      maxCount = nameCount[name];
      mostCommon = name;
    }
  });
  
  return mostCommon;
}

function getSmartAddress(records) {
  const garbage = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address'];
  let best = 'No address available';
  let maxLen = 0;
  
  records.forEach(r => {
    if (r.Address && r.Address.toString().trim().length > 0) {
      const addr = r.Address.toString().trim();
      const lower = addr.toLowerCase();
      
      if (!garbage.includes(lower) && addr.length > maxLen) {
        maxLen = addr.length;
        best = addr;
      }
    }
  });
  
  return best;
}

function getAllNumbers(records) {
  const numbers = records
    .map(r => r.Mobile)
    .filter(n => n && n.toString().trim().length > 0)
    .map(n => n.toString().trim());
  return [...new Set(numbers)];
}

function getAllCNICs(records) {
  const cnis = records
    .map(r => r.Cnic)
    .filter(c => c && c.toString().trim().length > 0)
    .map(c => c.toString().trim());
  return [...new Set(cnis)];
    }
