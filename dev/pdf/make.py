"""Test PDFs for the PDF viewer: Swiss German text in embedded, subset fonts,
justified and hyphenated the way real documents are. Needs PyMuPDF."""
import pymupdf
from pathlib import Path

HERE = Path(__file__).parent
FONTS = "C:/Windows/Fonts/"

PAGES = [
    ("Merkblatt für Neulenker", [
        "Für Neulenkerinnen und Neulenker gilt eine Probezeit von drei Jahren. Wer in dieser Zeit den Führerausweis "
        "verliert, muss eine verkehrspsychologische Abklärung machen. Die Weiterbildungskurse finden in der Regel "
        "am Samstag statt; eine verbindliche Offerte erhalten Sie bei der Fahrschule.",
        "Mit dem Velo zur Arbeit: Auf dem Trottoir ist das Velofahren verboten. Parkieren Sie Ihr Velo auf den "
        "markierten Parkfeldern beim Bahnhof. Wer falsch parkiert, muss eine Busse von 40 Franken bezahlen.",
        "Der Entscheid des Strassenverkehrsamts ist endgültig. Er kann innert 30 Tagen angefochten werden.",
    ]),
    ("Aus dem Kantonsspital", [
        "Das Kantonsspital Winterthur hat eine neue Notfallstation eröffnet. Grosse Teile des Spitals wurden "
        "renoviert, und im Estrich lagern noch die alten Betten. Das Personal freut sich über die schönen Zimmer.",
        "Zum Zvieri gibt es Rüebli, Glace und ein Stück Wähe. Herzliche Grüsse vom ganzen Team!",
    ]),
]


def build(path, regular, bold, size=11):
    doc = pymupdf.open()
    reg = pymupdf.Font(fontfile=FONTS + regular)
    bld = pymupdf.Font(fontfile=FONTS + bold)
    for title, paras in PAGES:
        page = doc.new_page(width=595, height=842)
        tw = pymupdf.TextWriter(page.rect)
        tw.append((72, 90), title, font=bld, fontsize=18)
        tw.write_text(page)
        y = 120
        for p in paras:
            tw = pymupdf.TextWriter(page.rect)
            rect = pymupdf.Rect(72, y, 523, y + 200)
            rest = tw.fill_textbox(rect, p, font=reg, fontsize=size, align=pymupdf.TEXT_ALIGN_JUSTIFY)
            tw.write_text(page)
            y = tw.last_point.y + size * 1.6
    doc.subset_fonts()
    doc.save(path, garbage=4, deflate=True)


build(HERE / "swiss-arial.pdf", "arial.ttf", "arialbd.ttf")
build(HERE / "swiss-georgia.pdf", "georgia.ttf", "georgiab.ttf", size=12)
print("ok")

# The same layout in English: nothing to convert, so the extension's viewer must
# look exactly like the browser's (dev/pdf/parity.py compares screenshots).
PAGES[:] = [
    ("Notes for new drivers", [
        "New drivers are on probation for three years. Anyone who loses their licence during this time must "
        "undergo a traffic psychology assessment. Further training courses usually take place on Saturdays.",
        "By bike to work: cycling on the pavement is prohibited. Park your bike in the marked spaces at the station.",
    ]),
    ("From the hospital", ["The cantonal hospital in Winterthur has opened a new emergency department."]),
]
build(HERE / "english.pdf", "arial.ttf", "arialbd.ttf")

# 30 pages, a page-numbered Swiss word on each, for find and for streaming.
PAGES[:] = [(f"Seite {n}", [f"Auf Seite {n} steht das Velo{n} beim Trottoir. " * 3,
                            "Parkieren Sie Ihr Velo auf den markierten Parkfeldern beim Bahnhof. " * 4]) for n in range(1, 31)]
build(HERE / "long.pdf", "arial.ttf", "arialbd.ttf")

# A labelled list item: the label in another font, so the paragraph is not
# reflowed and a longer word ("Spital" -> "Krankenhaus") must find room on its line.
def build_list(path):
    doc = pymupdf.open()
    reg, bld = pymupdf.Font(fontfile=FONTS + "arial.ttf"), pymupdf.Font(fontfile=FONTS + "arialbd.ttf")
    page = doc.new_page(width=595, height=842)
    tw = pymupdf.TextWriter(page.rect)
    tw.append((72, 100), "a", font=bld, fontsize=10)
    tw.append((100, 100), "die Untersuchungen und Behandlungen, die ambulant, stationär oder in einem Pflegeheim sowie die", font=reg, fontsize=10)
    tw.append((100, 113), "Pflegeleistungen, die in einem Spital durchgeführt werden von:", font=reg, fontsize=10)
    tw.append((72, 140), "b", font=bld, fontsize=10)
    tw.append((100, 140), "Wer ein Velo parkiert, braucht eine Bewilligung der Gemeinde.", font=reg, fontsize=10)
    tw.write_text(page)
    doc.subset_fonts()
    doc.save(path, garbage=4, deflate=True)


build_list(HERE / "list.pdf")


# Opened with the password "hdfx" (the viewer asks for it), and links: one to a
# website, one to the second page.
def build_extras():
    reg = pymupdf.Font(fontfile=FONTS + "arial.ttf")
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    tw = pymupdf.TextWriter(page.rect)
    tw.append((72, 100), "Geheim: Wer ein Velo parkiert, braucht eine Bewilligung.", font=reg, fontsize=12)
    tw.write_text(page)
    doc.subset_fonts()
    doc.save(HERE / "password.pdf", garbage=4, deflate=True, encryption=pymupdf.PDF_ENCRYPT_AES_256, user_pw="hdfx", owner_pw="hdfx-owner")

    doc = pymupdf.open()
    for n in (1, 2):
        page = doc.new_page(width=595, height=842)
        tw = pymupdf.TextWriter(page.rect)
        tw.append((72, 100), f"Seite {n}: Das Velo steht beim Bahnhof.", font=reg, fontsize=12)
        tw.write_text(page)
    page = doc[0]
    page.insert_text((72, 140), "Zur Website", fontname="helv", fontsize=12)
    page.insert_link({"kind": pymupdf.LINK_URI, "from": pymupdf.Rect(70, 128, 160, 144), "uri": "https://example.com/"})
    page.insert_text((72, 170), "Zu Seite 2", fontname="helv", fontsize=12)
    page.insert_link({"kind": pymupdf.LINK_GOTO, "from": pymupdf.Rect(70, 158, 160, 174), "page": 1, "to": pymupdf.Point(72, 100)})
    doc.subset_fonts()
    doc.save(HERE / "links.pdf", garbage=4, deflate=True)


build_extras()


# A form to fill in: a text field, a checkbox and a list, as on official forms.
def build_form():
    doc = pymupdf.open()
    page = doc.new_page(width=595, height=842)
    page.insert_text((72, 90), "Anmeldung für das Velo-Parkfeld", fontname="helv", fontsize=16)
    page.insert_text((72, 140), "Name:", fontname="helv", fontsize=11)
    w = pymupdf.Widget(); w.field_type = pymupdf.PDF_WIDGET_TYPE_TEXT; w.field_name = "name"
    w.rect = pymupdf.Rect(150, 126, 400, 146); w.text_fontsize = 11; page.add_widget(w)
    page.insert_text((72, 180), "Mit Velo:", fontname="helv", fontsize=11)
    w = pymupdf.Widget(); w.field_type = pymupdf.PDF_WIDGET_TYPE_CHECKBOX; w.field_name = "velo"
    w.rect = pymupdf.Rect(150, 168, 164, 182); page.add_widget(w)
    page.insert_text((72, 220), "Gemeinde:", fontname="helv", fontsize=11)
    w = pymupdf.Widget(); w.field_type = pymupdf.PDF_WIDGET_TYPE_COMBOBOX; w.field_name = "gemeinde"
    w.choice_values = ["Zürich", "Winterthur", "Bern"]; w.field_value = "Zürich"
    w.rect = pymupdf.Rect(150, 206, 300, 226); w.text_fontsize = 11; page.add_widget(w)
    doc.save(HERE / "form.pdf", garbage=4, deflate=True)


build_form()
