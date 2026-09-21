// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { NavigationContainer } from '@react-navigation/native';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DATABASE_NAME, initDatabase } from './src/db/client';
import { ALLOW_DEV_SEED_DATA } from './src/config/buildFlags';
import { seedDevData } from './src/db/seedDev';
import { BottomTabs } from './src/navigation/BottomTabs';

async function setUpDatabase(db: SQLiteDatabase) {
  await initDatabase(db);
  if (ALLOW_DEV_SEED_DATA) {
    await seedDevData(db);
  }
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={setUpDatabase}>
        <NavigationContainer>
          <BottomTabs />
          <StatusBar style="auto" />
        </NavigationContainer>
      </SQLiteProvider>
    </SafeAreaProvider>
  );
}
