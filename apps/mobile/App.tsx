import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

// App "olá" da Fase 0: só valida o ambiente (build e instalação no aparelho).
export default function App() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>A.P.O.L.O.</Text>
      <Text style={styles.subtitle}>Olá, Ricardo. Ambiente mobile funcionando.</Text>
      <StatusBar style="light" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b1220',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    color: '#7dd3fc',
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: 4,
  },
  subtitle: {
    color: '#cbd5e1',
    fontSize: 16,
    marginTop: 12,
    textAlign: 'center',
  },
});
