// ============================================
// PHONE & CNIC FORMATTERS
// Supports all input formats
// ============================================

module.exports = {
  /**
   * Normalize phone numbers to 92XXXXXXXXXX format
   * Supports: 03234567890, 3234567890, +923234567890, 
   *           923234567890, 00923234567890, +92 323 4567890
   */
  normalizePhone: (input) => {
    if (!input) return '';
    
    // Convert to string and remove all non-numeric except '+'
    let cleaned = input.toString().trim();
    
    // Remove spaces, dashes, parentheses
    cleaned = cleaned.replace(/[\s\-\(\)]/g, '');
    
    // Remove everything except numbers and '+'
    cleaned = cleaned.replace(/[^0-9+]/g, '');
    
    // Handle different formats
    if (cleaned.startsWith('+92')) {
      return cleaned.substring(1); // Remove '+' -> 92XXXXXXXXXX
    } else if (cleaned.startsWith('0092')) {
      return cleaned.substring(4); // Remove '0092' -> 92XXXXXXXXXX
    } else if (cleaned.startsWith('92')) {
      return cleaned; // Already in correct format
    } else if (cleaned.startsWith('0')) {
      return '92' + cleaned.substring(1); // 03XX -> 923XX
    } else if (cleaned.length === 10 && cleaned.startsWith('3')) {
      return '92' + cleaned; // 3XX -> 923XX
    } else if (cleaned.length === 11 && cleaned.startsWith('03')) {
      return '92' + cleaned.substring(1); // 03XX -> 923XX
    } else {
      // If all else fails, return as-is
      return cleaned;
    }
  },

  /**
   * Normalize CNIC to 13-digit format
   * Supports: 1234567890123, 12345-6789012-3, 12345 6789012 3
   */
  normalizeCNIC: (input) => {
    if (!input) return '';
    
    // Convert to string and remove all non-numeric
    let cleaned = input.toString().trim();
    cleaned = cleaned.replace(/[^0-9]/g, '');
    
    // Ensure it's 13 digits
    if (cleaned.length === 13) {
      return cleaned;
    } else if (cleaned.length === 12) {
      // Sometimes CNIC is missing leading zero
      return '0' + cleaned;
    } else if (cleaned.length > 13) {
      // Take first 13 digits if longer
      return cleaned.substring(0, 13);
    } else {
      // Return as-is if invalid
      return cleaned;
    }
  },

  /**
   * Detect if input is phone number or CNIC
   * Returns: 'phone', 'cnic', or 'unknown'
   */
  detectType: (input) => {
    if (!input) return 'unknown';
    
    const cleaned = input.toString().trim();
    
    // Remove spaces, dashes, etc. but keep '+' for phone detection
    const cleanedWithPlus = cleaned.replace(/[\s\-\(\)]/g, '');
    const numericOnly = cleaned.replace(/[^0-9]/g, '');
    
    // Check if it's a CNIC (13 digits, no '+')
    if (numericOnly.length === 13 && !cleanedWithPlus.includes('+')) {
      return 'cnic';
    }
    
    // Check if it's a phone (10-12 digits or contains '+')
    if (numericOnly.length >= 10 && numericOnly.length <= 12) {
      return 'phone';
    }
    
    if (cleanedWithPlus.includes('+')) {
      return 'phone';
    }
    
    // If starts with 0 and length is 11 (like 03XXXXXXXXX)
    if (cleanedWithPlus.startsWith('0') && numericOnly.length === 11) {
      return 'phone';
    }
    
    // If starts with 92 and length is 12
    if (cleanedWithPlus.startsWith('92') && numericOnly.length === 12) {
      return 'phone';
    }
    
    return 'unknown';
  },

  /**
   * Format phone number for display (optional)
   */
  formatPhoneDisplay: (phone) => {
    if (!phone) return '';
    const clean = phone.replace(/[^0-9]/g, '');
    if (clean.length === 11 && clean.startsWith('92')) {
      return `+${clean.substring(0, 2)} ${clean.substring(2, 5)} ${clean.substring(5, 8)} ${clean.substring(8)}`;
    }
    return phone;
  },

  /**
   * Format CNIC for display (optional)
   */
  formatCNICDisplay: (cnic) => {
    if (!cnic) return '';
    const clean = cnic.replace(/[^0-9]/g, '');
    if (clean.length === 13) {
      return `${clean.substring(0, 5)}-${clean.substring(5, 12)}-${clean.substring(12)}`;
    }
    return cnic;
  },

  /**
   * Extract all unique phone numbers from records
   */
  extractAllNumbers: (records) => {
    if (!records || !Array.isArray(records)) return [];
    const numbers = records
      .map(record => record.nbr)
      .filter(nbr => nbr && nbr.toString().trim().length > 0)
      .map(nbr => nbr.toString().trim());
    return [...new Set(numbers)]; // Remove duplicates
  },

  /**
   * Extract all unique CNICs from records
   */
  extractAllCNICs: (records) => {
    if (!records || !Array.isArray(records)) return [];
    const cnis = records
      .map(record => record.cni)
      .filter(cni => cni && cni.toString().trim().length > 0)
      .map(cni => cni.toString().trim());
    return [...new Set(cnis)];
  },

  /**
   * Find the most complete/longest address
   */
  findBestAddress: (records) => {
    if (!records || !Array.isArray(records) || records.length === 0) {
      return 'No address available';
    }
    
    let bestAddress = 'No address available';
    let maxLength = 0;
    let addressCount = 0;
    
    records.forEach(record => {
      if (record.adr && record.adr.toString().trim().length > 0) {
        const addr = record.adr.toString().trim();
        addressCount++;
        if (addr.length > maxLength) {
          maxLength = addr.length;
          bestAddress = addr;
        }
      }
    });
    
    return addressCount > 0 ? bestAddress : 'No address available';
  },

  /**
   * Find the most common name from records
   */
  findMostCommonName: (records) => {
    if (!records || !Array.isArray(records) || records.length === 0) {
      return 'Unknown';
    }
    
    const names = records
      .map(record => record.nam)
      .filter(name => name && name.toString().trim().length > 0)
      .map(name => name.toString().trim());
    
    if (names.length === 0) return 'Unknown';
    
    // Count frequency of each name
    const nameCounts = {};
    names.forEach(name => {
      nameCounts[name] = (nameCounts[name] || 0) + 1;
    });
    
    // Find the most common name
    let mostCommon = names[0];
    let maxCount = 0;
    Object.keys(nameCounts).forEach(name => {
      if (nameCounts[name] > maxCount) {
        maxCount = nameCounts[name];
        mostCommon = name;
      }
    });
    
    return mostCommon;
  }
};
