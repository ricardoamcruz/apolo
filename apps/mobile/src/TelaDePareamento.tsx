import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { lerCodigo, type Pareamento } from './pareamento'
import { COR_APAGADA, COR_DA_INTERFACE, COR_DE_FUNDO, COR_DO_TEXTO, FONTE_MONO } from './tema'

type Props = {
  aviso?: string
  aoParear: (par: Pareamento) => void
}

export function TelaDePareamento({ aviso, aoParear }: Props) {
  const [codigo, setCodigo] = useState('')
  const [erro, setErro] = useState('')

  const conectar = () => {
    const par = lerCodigo(codigo)
    if (!par) return setErro('Código inválido. Copie de novo no Mac.')
    aoParear(par)
  }

  return (
    <View style={styles.painel}>
      <Text style={styles.titulo}>PAREAR COM O MAC</Text>
      <Text style={styles.texto}>
        No Mac, rode npm run celular e cole aqui o código que ele copiou. Este aparelho precisa
        estar com o Tailscale ligado.
      </Text>
      <TextInput
        style={styles.campo}
        value={codigo}
        onChangeText={setCodigo}
        placeholder="https://…ts.net#…"
        placeholderTextColor={COR_APAGADA}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />
      {(erro || aviso) && <Text style={styles.erro}>{erro || aviso}</Text>}
      <Pressable style={styles.botao} onPress={conectar}>
        <Text style={styles.textoDoBotao}>CONECTAR</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  painel: {
    gap: 14,
    padding: 20,
    borderWidth: 1,
    borderColor: `${COR_DA_INTERFACE}55`,
    backgroundColor: `${COR_DE_FUNDO}e6`,
  },
  titulo: { color: COR_DA_INTERFACE, fontFamily: FONTE_MONO, fontSize: 13, letterSpacing: 3 },
  texto: { color: COR_DO_TEXTO, fontSize: 15, lineHeight: 21 },
  campo: {
    color: COR_DO_TEXTO,
    fontFamily: FONTE_MONO,
    fontSize: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: `${COR_DA_INTERFACE}44`,
  },
  erro: { color: '#ff8a70', fontSize: 14 },
  botao: { alignItems: 'center', padding: 13, backgroundColor: `${COR_DA_INTERFACE}22` },
  textoDoBotao: { color: COR_DA_INTERFACE, fontFamily: FONTE_MONO, fontSize: 14, letterSpacing: 2 },
})
