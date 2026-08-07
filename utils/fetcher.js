/**
 * Find the most common REAL name from records
 * Ignores "DATA NOT RECIEVED FROM NADRA" and similar garbage
 */
const findMostCommonName = (records) => {
  if (!records || !Array.isArray(records) || records.length === 0) {
    return 'Unknown';
  }
  
  // Blacklist of fake/error names to ignore
  const blacklist = [
    'data not recieved from nadra',
    'data not received from nadra',
    'not received',
    'no data',
    'unknown',
    'n/a',
    'null',
    'undefined',
    'no',
    '-'
  ];
  
  // Filter out blacklisted names
  const validNames = records
    .map(record => record.nam)
    .filter(name => {
      if (!name) return false;
      const cleanName = name.toString().trim();
      if (cleanName.length < 2) return false; // Too short
      
      // Check if name is in blacklist (case insensitive)
      const lowerName = cleanName.toLowerCase();
      return !blacklist.some(bad => lowerName.includes(bad));
    })
    .map(name => name.toString().trim());
  
  if (validNames.length === 0) {
    // If all names are garbage, return first record's name (even if garbage)
    return records[0]?.nam?.toString().trim() || 'Unknown';
  }
  
  // Count frequency of each valid name
  const nameCounts = {};
  validNames.forEach(name => {
    nameCounts[name] = (nameCounts[name] || 0) + 1;
  });
  
  // Find the most common name
  let mostCommon = validNames[0];
  let maxCount = 0;
  Object.keys(nameCounts).forEach(name => {
    if (nameCounts[name] > maxCount) {
      maxCount = nameCounts[name];
      mostCommon = name;
    }
  });
  
  return mostCommon;
};

/**
 * Also fix address - ignore "no", "n/a" etc.
 */
const findBestAddress = (records) => {
  if (!records || !Array.isArray(records) || records.length === 0) {
    return 'No address available';
  }
  
  const blacklist = ['no', 'n/a', 'null', 'undefined', '-', 'na'];
  
  let bestAddress = 'No address available';
  let maxLength = 0;
  let addressCount = 0;
  
  records.forEach(record => {
    if (record.adr && record.adr.toString().trim().length > 0) {
      const addr = record.adr.toString().trim();
      const lowerAddr = addr.toLowerCase();
      
      // Skip blacklisted addresses
      if (blacklist.includes(lowerAddr) || lowerAddr === 'no') {
        return;
      }
      
      addressCount++;
      // Prefer longer addresses (more detailed)
      if (addr.length > maxLength) {
        maxLength = addr.length;
        bestAddress = addr;
      }
    }
  });
  
  // If we found no valid address, try to get any address
  if (addressCount === 0) {
    const anyAddress = records.find(r => r.adr && r.adr.toString().trim().length > 0);
    return anyAddress ? anyAddress.adr.toString().trim() : 'No address available';
  }
  
  return bestAddress;
};
