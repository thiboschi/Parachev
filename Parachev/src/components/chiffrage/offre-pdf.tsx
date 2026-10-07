import { Document, Page, Rect, StyleSheet, Svg, Text, View, pdf } from "@react-pdf/renderer"

// Offre de prix générée depuis la page "Chiffrage" : tout ce qui y est saisi
// et chiffré, mis en page pour être envoyé au client. Ce module embarque
// @react-pdf/renderer : il est chargé à la demande (import dynamique).

export interface LigneInfo {
  label: string
  valeur: string
}

export interface OperationOffre {
  libelle: string
  /** Quantités saisies dans le module du poste. */
  details: string[]
  heures: number
}

/** Un groupe de barres identiques : une ligne du tableau "Objet de l'offre". */
export interface BarresOffre {
  nombre: string
  profil: string
  /** Par barre, en mm ; null si non renseignée. */
  longueur: number | null
  /** Par barre, en t. */
  poids: string
  /** Quantités saisies pour ce groupe dans les modules de ses postes, dans
   *  l'ordre de la gamme. */
  operations: string[]
}

export interface SoudureOffre {
  designation: string
  nombre: string
  longueur: string
  preparation: string
  passes: string
}

export interface DonneesOffre {
  date: Date
  client: string
  numeroOffre: string
  numeroCommande: string
  numeroLaminage: string
  typeAffaire: string
  barres: BarresOffre[]
  normes: LigneInfo[]
  operations: OperationOffre[]
  /** Pièces à souder sur une barre (calculateur de soudage). */
  soudures: SoudureOffre[]
  totalHeures: number
  /** Majorations appliquées au total (DBS, tolérance classe 2). */
  majorations: { label: string; heures: number }[]
  sousTotalHeures: number
  /** Multiplicateur (€/h) et montant, null si non renseigné. */
  tauxHoraire: number | null
  montant: number | null
}

const MARINE = "#1e3a5f"
const GRIS = "#64748b"
const TRAIT = "#e2e8f0"
const FOND = "#f4f6f8"

// Les polices standard du PDF n'ont pas l'espace fine insécable que
// toLocaleString utilise comme séparateur de milliers.
const format = (value: number, decimales: number, minimum = 0) =>
  value
    .toLocaleString("fr-BE", { minimumFractionDigits: minimum, maximumFractionDigits: decimales })
    .replace(/[  ]/g, " ")

const heures = (value: number) => `${format(value, 1)} h`
const euros = (value: number) => `${format(value, 2, 2)} €`

const styles = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: "#0f172a",
    lineHeight: 1.35,
  },
  entete: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: MARINE,
  },
  marque: { flexDirection: "row", alignItems: "center", gap: 8 },
  nomMarque: { fontFamily: "Helvetica-Bold", fontSize: 18, color: MARINE, letterSpacing: 1 },
  titre: { fontFamily: "Helvetica-Bold", fontSize: 16, lineHeight: 1.2, color: MARINE, textAlign: "right" },
  sousTitre: { color: GRIS, textAlign: "right", marginTop: 2 },
  blocs: { flexDirection: "row", gap: 12, marginTop: 16 },
  bloc: { flex: 1, backgroundColor: FOND, borderRadius: 4, padding: 10 },
  etiquette: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7.5,
    color: GRIS,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 4,
  },
  nomClient: { fontFamily: "Helvetica-Bold", fontSize: 12 },
  section: { marginTop: 18 },
  titreSection: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10.5,
    color: MARINE,
    paddingBottom: 4,
    marginBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: TRAIT,
  },
  grille: { flexDirection: "row", flexWrap: "wrap" },
  info: { width: "50%", flexDirection: "row", paddingVertical: 2, paddingRight: 10 },
  infoLabel: { width: "55%", color: GRIS },
  infoValeur: { width: "45%", fontFamily: "Helvetica-Bold" },
  ligneTableau: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: TRAIT,
  },
  enteteTableau: { backgroundColor: MARINE, borderBottomWidth: 0, borderRadius: 2 },
  celluleEntete: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#ffffff" },
  droite: { textAlign: "right" },
  detail: { color: GRIS, fontSize: 8.5 },
  totaux: { marginTop: 10, marginLeft: "auto", width: "52%" },
  ligneTotal: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3, paddingHorizontal: 6 },
  gras: { fontFamily: "Helvetica-Bold" },
  montant: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 6,
    padding: 8,
    backgroundColor: MARINE,
    borderRadius: 4,
  },
  texteMontant: { fontFamily: "Helvetica-Bold", fontSize: 12, color: "#ffffff" },
  pied: { position: "absolute", bottom: 26, left: 40, fontSize: 8, color: GRIS },
})

// Même dessin que assets/logo_parachev_icone.svg.
function Logo() {
  return (
    <Svg width={30} height={30} viewBox="30 30 140 140">
      <Rect x={30} y={30} width={140} height={140} rx={28} fill={MARINE} />
      <Rect x={75} y={55} width={50} height={14} rx={2} fill={FOND} />
      <Rect x={58} y={131} width={84} height={14} rx={2} fill={FOND} />
      <Rect x={93} y={69} width={14} height={62} fill={FOND} />
    </Svg>
  )
}

function Infos({ lignes }: { lignes: LigneInfo[] }) {
  return (
    <View style={styles.grille}>
      {lignes.map(({ label, valeur }) => (
        <View key={label} style={styles.info}>
          <Text style={styles.infoLabel}>{label}</Text>
          <Text style={styles.infoValeur}>{valeur}</Text>
        </View>
      ))}
    </View>
  )
}

// Largeurs des colonnes du tableau des groupes de barres.
const COLONNES_BARRES = ["10%", "15%", "17%", "14%", "44%"]

// Largeurs des colonnes du tableau des pièces à souder.
const COLONNES_SOUDURES = ["34%", "12%", "20%", "22%", "12%"]

function OffrePdf({ offre }: { offre: DonneesOffre }) {
  const date = offre.date.toLocaleDateString("fr-BE", { day: "numeric", month: "long", year: "numeric" })
  const references: LigneInfo[] = [
    { label: "N° de commande", valeur: offre.numeroCommande },
    { label: "N° de laminage", valeur: offre.numeroLaminage },
  ].filter(({ valeur }) => valeur !== "")

  return (
    <Document title={`Offre ${offre.numeroOffre}`.trim()} author="Parachev">
      <Page size="A4" style={styles.page}>
        <View style={styles.entete} fixed>
          <View style={styles.marque}>
            <Logo />
            <Text style={styles.nomMarque}>PARACHEV</Text>
          </View>
          <View>
            <Text style={styles.titre}>OFFRE DE PRIX</Text>
            {offre.numeroOffre !== "" && <Text style={styles.sousTitre}>N° {offre.numeroOffre}</Text>}
            <Text style={styles.sousTitre}>{date}</Text>
          </View>
        </View>

        <View style={styles.blocs}>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>Client</Text>
            <Text style={styles.nomClient}>{offre.client || "—"}</Text>
          </View>
          <View style={styles.bloc}>
            <Text style={styles.etiquette}>Références</Text>
            {references.length === 0 && <Text>—</Text>}
            {references.map(({ label, valeur }) => (
              <Text key={label}>
                {label} : <Text style={styles.gras}>{valeur}</Text>
              </Text>
            ))}
          </View>
        </View>

        {offre.normes.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Normes et exigences</Text>
            <Infos lignes={offre.normes} />
          </View>
        )}

        {offre.barres.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Objet de l'offre</Text>
            {offre.typeAffaire !== "" && (
              <Text style={{ marginBottom: 6 }}>
                Type d'affaire : <Text style={styles.gras}>{offre.typeAffaire}</Text>
              </Text>
            )}
            <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
              {["Nb barres", "Profil", "Longueur / barre (mm)", "Poids / barre (t)", "Opérations"].map((colonne, i) => (
                <Text
                  key={colonne}
                  style={[
                    styles.celluleEntete,
                    { width: COLONNES_BARRES[i] },
                    i === 4 ? { paddingLeft: 12 } : {},
                    i === 2 || i === 3 ? styles.droite : {},
                  ]}
                >
                  {colonne}
                </Text>
              ))}
            </View>
            {offre.barres.map((barres, i) => (
              <View key={i} style={styles.ligneTableau} wrap={false}>
                <Text style={{ width: COLONNES_BARRES[0] }}>{barres.nombre || "—"}</Text>
                <Text style={[styles.gras, { width: COLONNES_BARRES[1] }]}>{barres.profil || "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_BARRES[2] }]}>{barres.longueur !== null ? format(barres.longueur, 1) : "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_BARRES[3] }]}>{barres.poids || "—"}</Text>
                <View style={{ width: COLONNES_BARRES[4], paddingLeft: 12 }}>
                  {barres.operations.length === 0 && <Text>—</Text>}
                  {barres.operations.map((detail, j) => (
                    <Text key={j}>{detail}</Text>
                  ))}
                </View>
              </View>
            ))}
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.titreSection}>Détail des opérations</Text>
          <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
            <Text style={[styles.celluleEntete, { width: "32%" }]}>Opération</Text>
            <Text style={[styles.celluleEntete, { width: "50%" }]}>Détail</Text>
            <Text style={[styles.celluleEntete, styles.droite, { width: "18%" }]}>Temps</Text>
          </View>
          {offre.operations.map(({ libelle, details, heures: temps }) => (
            <View key={libelle} style={styles.ligneTableau} wrap={false}>
              <Text style={[styles.gras, { width: "32%" }]}>{libelle}</Text>
              <View style={{ width: "50%" }}>
                {details.map((detail) => (
                  <Text key={detail} style={styles.detail}>
                    {detail}
                  </Text>
                ))}
              </View>
              <Text style={[styles.droite, { width: "18%" }]}>{temps > 0 ? heures(temps) : "—"}</Text>
            </View>
          ))}

          <View style={styles.totaux} wrap={false}>
            <View style={styles.ligneTotal}>
              <Text style={styles.gras}>Total</Text>
              <Text style={styles.gras}>{heures(offre.totalHeures)}</Text>
            </View>
            {offre.majorations.map(({ label, heures: temps }) => (
              <View key={label} style={styles.ligneTotal}>
                <Text style={styles.detail}>{label}</Text>
                <Text style={styles.detail}>{heures(temps)}</Text>
              </View>
            ))}
            {offre.majorations.length > 0 && (
              <View style={[styles.ligneTotal, { borderTopWidth: 1, borderTopColor: TRAIT }]}>
                <Text style={styles.gras}>Sous-total</Text>
                <Text style={styles.gras}>{heures(offre.sousTotalHeures)}</Text>
              </View>
            )}
            {offre.tauxHoraire !== null && (
              <View style={styles.ligneTotal}>
                <Text style={styles.detail}>Taux horaire</Text>
                <Text style={styles.detail}>{euros(offre.tauxHoraire)} / h</Text>
              </View>
            )}
            {offre.montant !== null && (
              <View style={styles.montant}>
                <Text style={styles.texteMontant}>Montant HT</Text>
                <Text style={styles.texteMontant}>{euros(offre.montant)}</Text>
              </View>
            )}
          </View>
        </View>

        {offre.soudures.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.titreSection}>Soudage — pièces à souder par barre</Text>
            <View style={[styles.ligneTableau, styles.enteteTableau]} fixed>
              {["Désignation", "Nombre", "Longueur (mm)", "Préparation", "Passes"].map((colonne, i) => (
                <Text
                  key={colonne}
                  style={[
                    styles.celluleEntete,
                    { width: COLONNES_SOUDURES[i] },
                    i === 3 ? { paddingLeft: 12 } : {},
                    i === 1 || i === 2 || i === 4 ? styles.droite : {},
                  ]}
                >
                  {colonne}
                </Text>
              ))}
            </View>
            {offre.soudures.map((soudure, i) => (
              <View key={i} style={styles.ligneTableau} wrap={false}>
                <Text style={{ width: COLONNES_SOUDURES[0] }}>{soudure.designation || "—"}</Text>
                <Text style={[styles.droite, { width: COLONNES_SOUDURES[1] }]}>{soudure.nombre}</Text>
                <Text style={[styles.droite, { width: COLONNES_SOUDURES[2] }]}>{soudure.longueur}</Text>
                <Text style={{ width: COLONNES_SOUDURES[3], paddingLeft: 12 }}>{soudure.preparation}</Text>
                <Text style={[styles.droite, { width: COLONNES_SOUDURES[4] }]}>{soudure.passes}</Text>
              </View>
            ))}
          </View>
        )}

        <Text style={styles.pied} fixed>
          Parachev · Offre {offre.numeroOffre !== "" ? `n° ${offre.numeroOffre} ` : ""}du {date}
        </Text>
      </Page>
    </Document>
  )
}

/** Contenu du fichier PDF de l'offre. */
export async function genererOffrePdf(offre: DonneesOffre): Promise<Uint8Array> {
  const blob = await pdf(<OffrePdf offre={offre} />).toBlob()
  return new Uint8Array(await blob.arrayBuffer())
}
