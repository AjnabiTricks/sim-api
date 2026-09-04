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
      error: 'Please provide "search" parameter (Phone number or CNIC)'
    });
  }

  // --- CLEAN INPUT ---
  let cleanInput = search.trim()
    .replace(/\s/g, '')
    .replace(/-/g, '')
    .replace(/\(/g, '')
    .replace(/\)/g, '')
    .replace(/\+/g, '');

  // Detect type
  let isCNIC = /^[0-9]{13}$/.test(cleanInput);
  let phoneNumber = cleanInput;

  // Format phone number if needed
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
    console.log(`🔍 Searching: ${isCNIC ? 'CNIC' : 'Phone'}: ${cleanInput}`);

    // =============================================
    // 📞 SEARCH FUNCTION - PaksimDatabases.com API
    // =============================================
    async function searchPaksimDatabases(query) {
      try {
        const url = 'https://paksimdatabases.com/numberDetails.php';
        console.log(`📡 Fetching: ${url} for ${query}`);
        
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'host': 'paksimdatabases.com',
            'content-type': 'application/x-www-form-urlencoded',
            'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Mobile Safari/537.36',
            'origin': 'https://paksimdatabases.com',
            'referer': 'https://paksimdatabases.com/',
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'ur,en-US;q=0.9,en;q=0.8',
            'cache-control': 'max-age=0',
            'sec-ch-ua': '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
            'sec-ch-ua-mobile': '?1',
            'sec-ch-ua-platform': '"Android"',
            'upgrade-insecure-requests': '1'
          },
          body: new URLSearchParams({
            numberCnic: query,
            searchNumber: ''
          })
        });

        if (!response.ok) {
          console.log(`HTTP Error: ${response.status}`);
          return [];
        }

        const html = await response.text();
        console.log(`📄 HTML Length: ${html.length}`);
        
        // Check if no data
        if (html.includes('No record found') || html.includes('No data found') || html.includes('not found')) {
          console.log('⚠️ No record found');
          return [];
        }
        
        // Parse HTML
        const parsed = parsePaksimDatabasesHTML(html);
        console.log(`✅ Parsed ${parsed.length} records`);
        return parsed;
        
      } catch (error) {
        console.error('Search error:', error);
        return [];
      }
    }

    // =============================================
    // 🔍 SEARCH LOGIC
    // =============================================
    let allRecords = [];
    let detectedCNIC = null;

    // First search
    let initialRecords = await searchPaksimDatabases(cleanInput);
    
    if (initialRecords.length > 0) {
      allRecords = initialRecords;
      
      // Extract CNIC from results
      const cnis = getAllCNICs(initialRecords);
      if (cnis.length > 0) {
        detectedCNIC = cnis[0];
        console.log(`📌 Found CNIC: ${detectedCNIC}`);
        
        // If searching by phone or CNIC, get ALL numbers for this CNIC
        const cnicRecords = await searchPaksimDatabases(detectedCNIC);
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

    console.log(`📊 Total unique records: ${uniqueData.length}`);

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
// 🔧 PAKSIMDATABASES HTML PARSER
// =============================================
function parsePaksimDatabasesHTML(html) {
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
        
        // Check if we have at least 3-4 cells
        if (cells.length >= 3) {
          let name = 'N/A', cnic = 'N/A', mobile = 'N/A', address = 'N/A';
          
          // Try to identify columns by content
          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            if (cell.match(/^[0-9]{13}$/)) {
              cnic = cell;
            } else if (cell.match(/^03[0-9]{9}$/)) {
              mobile = cell;
            } else if (cell.match(/[A-Za-z]/) && cell.length > 2 && !cell.match(/^[0-9]+$/)) {
              if (name === 'N/A') {
                name = cell;
              } else if (address === 'N/A') {
                address = cell;
              }
            }
          }
          
          // If we have at least name and mobile, add record
          if (name !== 'N/A' && mobile !== 'N/A') {
            // Clean up data
            const cleanName = name.replace(/\s+/g, ' ').trim();
            const cleanCnic = cnic.replace(/\s+/g, ' ').trim();
            const cleanMobile = mobile.replace(/\s+/g, ' ').trim();
            const cleanAddress = address.replace(/\s+/g, ' ').trim();
            
            results.push({
              Name: cleanName,
              Cnic: cleanCnic,
              Mobile: cleanMobile,
              Address: cleanAddress || 'No address'
            });
          }
        }
      }
    }
    
    // If table method failed, try alternative
    if (results.length === 0) {
      console.log('⚠️ Table parsing failed, trying alternative...');
      return parseAlternative(html);
    }
    
    return results;
    
  } catch (error) {
    console.error('Parser error:', error);
    return [];
  }
}

// =============================================
// 🔧 ALTERNATIVE PARSER (If table not found)
// =============================================
function parseAlternative(html) {
  try {
    const results = [];
    
    // Remove scripts and styles
    const clean = html.replace(/<script[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[\s\S]*?<\/style>/gi, '');
    
    // Extract all text
    const text = clean.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    
    // Find CNIC (13 digits)
    const cnicMatches = text.match(/\b([0-9]{13})\b/g) || [];
    
    // Find Mobile (11 digits starting with 03)
    const mobileMatches = text.match(/\b(03[0-9]{9})\b/g) || [];
    
    // Find Names (2+ words, alphabetic)
    const nameMatches = text.match(/\b([A-Z][a-z]+ [A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/g) || [];
    
    // Find Addresses (long text with numbers)
    const addressMatches = text.match(/\b([A-Z][a-z]+ [0-9]+ [A-Za-z\s,]+)/g) || [];
    
    // Combine into records
    const maxLen = Math.max(
      cnicMatches.length,
      mobileMatches.length,
      nameMatches.length
    );
    
    for (let i = 0; i < maxLen; i++) {
      const name = nameMatches[i] || 'Unknown';
      const cnic = cnicMatches[i] || 'N/A';
      const mobile = mobileMatches[i] || 'N/A';
      const address = addressMatches[i] || 'No address';
      
      if (mobile !== 'N/A' && name !== 'Unknown') {
        results.push({
          Name: name.trim(),
          Cnic: cnic.trim(),
          Mobile: mobile.trim(),
          Address: address.trim()
        });
      }
    }
    
    return results;
    
  } catch (error) {
    console.error('Alternative parser error:', error);
    return [];
  }
}

// =============================================
// 🔧 SMART HELPER FUNCTIONS
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
    'search',
    'not found'
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
  const garbage = ['no', 'n/a', 'null', 'undefined', '-', 'na', 'no address', 'none', 'nill'];
  
  let bestAddress = 'No address available';
  let maxLength = 0;
  
  records.forEach(record => {
    if (record.Address && record.Address.toString().trim().length > 0) {
      const addr = record.Address.toString().trim();
      const lower = addr.toLowerCase();
      
      if (garbage.includes(lower)) return;
      
      if (addr.length > maxLength) {
        maxLength = addr.length;
        bestAddress = addr;
      }
    }
  });
  
  return bestAddress;
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
    .map(c => c.toString().trim())
    .filter(c => c.length >= 13);
  return [...new Set(cnis)];
              }
