// © 2026 David Juste. All rights reserved. Proprietary and confidential.

import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { RosterScreen } from '../screens/RosterScreen';
import { LeaveScreen } from '../screens/LeaveScreen';
import { PlaceholderScreen } from '../screens/PlaceholderScreen';

const Tab = createBottomTabNavigator();

export function BottomTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        headerTintColor: '#1F4E79',
        tabBarActiveTintColor: '#1F4E79',
      }}
    >
      <Tab.Screen name="Roster" component={RosterScreen} />
      <Tab.Screen name="Duties">
        {() => <PlaceholderScreen title="Duties" note="Cleaning duties shell arrives in a later build phase." />}
      </Tab.Screen>
      <Tab.Screen name="Staff">
        {() => <PlaceholderScreen title="Staff" note="Add / Transfer / Remove staff arrives in a later build phase." />}
      </Tab.Screen>
      <Tab.Screen name="Leave" component={LeaveScreen} />
      <Tab.Screen name="Fairness">
        {() => <PlaceholderScreen title="Fairness" note="The fairness dashboard arrives in a later build phase." />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}
