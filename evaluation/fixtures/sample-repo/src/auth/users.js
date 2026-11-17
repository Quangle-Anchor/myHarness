const users = [
  { id: 'u1', name: 'mara', password: 'tulip-ladder' },
  { id: 'u2', name: 'ines', password: 'copper-kite' },
]

export function findUser(name, password) {
  return users.find((user) => user.name === name && user.password === password) ?? null
}
