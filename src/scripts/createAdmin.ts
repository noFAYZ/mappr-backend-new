#!/usr/bin/env tsx

/**
 * Script to create the first admin user for the system
 * Usage: tsx src/scripts/createAdmin.ts
 */

import { adminHelpers } from '@/utils/adminHelpers';
import { logger } from '@/utils/logger';
import * as readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function askQuestion(question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, resolve);
  });
}

function askPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(question);
    stdin.resume();
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');

    let password = '';
    stdin.on('data', (key: string) => {
      if (key === '\r' || key === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n');
        resolve(password);
      } else if (key === '\u0003') {
        // Ctrl+C
        process.exit(0);
      } else if (key === '\u007f') {
        // Backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += key;
        stdout.write('*');
      }
    });
  });
}

async function createAdminUser() {
  try {
    console.log('🔧 Admin User Creation Script');
    console.log('===============================\n');

    const email = await askQuestion('Enter admin email: ');
    if (!email || !email.includes('@')) {
      console.error('❌ Invalid email address');
      process.exit(1);
    }

    const firstName = await askQuestion('Enter first name: ');
    if (!firstName) {
      console.error('❌ First name is required');
      process.exit(1);
    }

    const lastName = await askQuestion('Enter last name: ');
    if (!lastName) {
      console.error('❌ Last name is required');
      process.exit(1);
    }

    const password = await askPassword('Enter password (min 8 characters): ');
    if (!password || password.length < 8) {
      console.error('❌ Password must be at least 8 characters long');
      process.exit(1);
    }

    const confirmPassword = await askPassword('Confirm password: ');
    if (password !== confirmPassword) {
      console.error('❌ Passwords do not match');
      process.exit(1);
    }

    console.log('\n🔄 Creating admin user...\n');

    const admin = await adminHelpers.createSystemAdmin(email, password, firstName, lastName);

    console.log('✅ Admin user created successfully!');
    console.log(`📧 Email: ${admin.email}`);
    console.log(`👤 Name: ${admin.firstName} ${admin.lastName}`);
    console.log(`🔐 Role: ${admin.role}`);
    console.log(`📅 Created: ${admin.createdAt}\n`);

    console.log('🎉 You can now use this account to access the admin dashboard');
    console.log(`🌐 Admin Dashboard: /api/v1/admin/`);
    console.log(`📚 API Documentation: /docs\n`);

  } catch (error: any) {
    console.error('❌ Failed to create admin user:', error.message);
    logger.error('Admin creation script error:', error);
    process.exit(1);
  } finally {
    rl.close();
    process.exit(0);
  }
}

// Run the script
createAdminUser();