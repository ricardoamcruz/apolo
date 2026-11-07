import * as SecureStore from 'expo-secure-store'
import type { Pareamento } from './pareamento'

const CHAVE = 'apolo.pareamento'

/** No Keychain e preso a este aparelho: o token não vai para backup nenhum. */
const OPCOES = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }

export async function lerPareamento(): Promise<Pareamento | null> {
  const salvo = await SecureStore.getItemAsync(CHAVE, OPCOES)
  return salvo ? (JSON.parse(salvo) as Pareamento) : null
}

export const salvarPareamento = (par: Pareamento) =>
  SecureStore.setItemAsync(CHAVE, JSON.stringify(par), OPCOES)

export const apagarPareamento = () => SecureStore.deleteItemAsync(CHAVE, OPCOES)
