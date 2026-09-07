import { useEffect } from "react";
import { Text } from "react-native";
import {
  NavigationContainer,
  createNavigationContainerRef,
  DefaultTheme,
  DarkTheme,
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { useColorScheme } from "react-native";

import { useAuth } from "../context/AuthContext";
import { getTheme } from "../theme";
import { attachNotificationRouting } from "../services/notifications";

import LoginScreen from "../screens/LoginScreen";
import RegisterScreen from "../screens/RegisterScreen";
import ChatListScreen from "../screens/ChatListScreen";
import ChatScreen from "../screens/ChatScreen";
import ProfileScreen from "../screens/ProfileScreen";
import AdminScreen from "../screens/AdminScreen";

export const navigationRef = createNavigationContainerRef();

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function TabIcon({ label, focused, color }) {
  return <Text style={{ fontSize: 18, opacity: focused ? 1 : 0.6, color }}>{label}</Text>;
}

function MainTabs() {
  const { isAdmin } = useAuth();
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }}>
      <Tab.Screen
        name="Chats"
        component={ChatListScreen}
        options={{
          tabBarLabel: "چت‌ها",
          tabBarIcon: (p) => <TabIcon label="💬" {...p} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{
          tabBarLabel: "پروفایل",
          tabBarIcon: (p) => <TabIcon label="👤" {...p} />,
        }}
      />
      {isAdmin && (
        <Tab.Screen
          name="Admin"
          component={AdminScreen}
          options={{
            tabBarLabel: "مدیریت",
            tabBarIcon: (p) => <TabIcon label="🛠️" {...p} />,
          }}
        />
      )}
    </Tab.Navigator>
  );
}

export default function RootNavigator() {
  const { signedIn } = useAuth();
  const scheme = useColorScheme();
  const palette = getTheme(scheme);

  useEffect(() => {
    if (!signedIn) return undefined;
    // Route a tapped notification (cold or warm) to its chat.
    return attachNotificationRouting((chatId) => {
      if (navigationRef.isReady()) {
        navigationRef.navigate("Chat", { chatId });
      }
    });
  }, [signedIn]);

  const navTheme = {
    ...(scheme === "dark" ? DarkTheme : DefaultTheme),
    colors: {
      ...(scheme === "dark" ? DarkTheme : DefaultTheme).colors,
      background: palette.bg,
      card: palette.card,
      border: palette.border,
      primary: palette.primary,
      text: palette.text,
    },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!signedIn ? (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Chat" component={ChatScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
